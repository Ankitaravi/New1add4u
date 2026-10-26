import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Payment, PaymentPurpose } from '../generated/prisma/client';
import { PAYMENT_HOLD_MS } from '../common/dates';
import { priceOf } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGateway, RAZORPAY_GATEWAY } from './razorpay.gateway';

function secret(): string {
  const s = process.env.RAZORPAY_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('RAZORPAY_SECRET is required in production');
  return 'test_secret';
}
function webhookSecret(): string {
  const s = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('RAZORPAY_WEBHOOK_SECRET is required in production');
  return 'test_webhook_secret';
}

const hmac = (key: string, data: string | Buffer) => createHmac('sha256', key).update(data).digest('hex');
const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b ?? '');
  return x.length === y.length && timingSafeEqual(x, y);
};

export const sign = (orderId: string, paymentId: string) => hmac(secret(), orderId + '|' + paymentId);
export const signWebhook = (rawBody: string | Buffer) => hmac(webhookSecret(), rawBody);

@Injectable()
export class PaymentsService {
  private log = new Logger(PaymentsService.name);
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @Inject(RAZORPAY_GATEWAY) private gateway: PaymentGateway,
  ) {}

  /** What the user owes for a payable record, or throws if it is not payable. */
  private async amountFor(userId: string | null, purpose: PaymentPurpose, refId: string): Promise<number> {
    const mine = (owner: string) => userId === null || owner === userId;
    if (purpose === 'APPOINTMENT') {
      await this.prisma.appointment.updateMany({
        where: { id: refId, status: 'PENDING_PAYMENT', createdAt: { lt: new Date(Date.now() - PAYMENT_HOLD_MS) } },
        data: { status: 'EXPIRED' },
      });
      const a = await this.prisma.appointment.findUnique({ where: { id: refId } });
      if (!a || !mine(a.userId)) throw new NotFoundException('Appointment not found');
      if (a.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Appointment is ${a.status}`);
      return a.totalPaise;
    }
    if (purpose === 'LAB_BOOKING') {
      const l = await this.prisma.labBooking.findUnique({ where: { id: refId } });
      if (!l || !mine(l.userId)) throw new NotFoundException('Lab booking not found');
      if (l.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Lab booking is ${l.status}`);
      return l.totalPaise;
    }
    if (purpose === 'STAFF_VISIT') {
      const v = await this.prisma.staffVisit.findUnique({ where: { id: refId } });
      if (!v || !mine(v.userId)) throw new NotFoundException('Visit not found');
      if (v.status !== 'PENDING_PAYMENT') throw new BadRequestException(`Visit is ${v.status}`);
      return v.totalPaise;
    }
    const o = await this.prisma.pharmaOrder.findUnique({ where: { id: refId } });
    if (!o || !mine(o.userId)) throw new NotFoundException('Order not found');
    if (o.status !== 'quoted') throw new BadRequestException(`Order is ${o.status}; only quoted orders can be paid`);
    return priceOf(o.totalPaise).totalPaise;
  }

  async createOrder(userId: string, purpose: PaymentPurpose, refId: string) {
    const amountPaise = await this.amountFor(userId, purpose, refId);
    const existing = await this.prisma.payment.findFirst({ where: { refId, purpose, status: 'CREATED', userId } });
    if (existing && existing.amountPaise === amountPaise) return this.out(existing);
    const orderId = await this.gateway.createOrder(amountPaise, refId);
    const p = await this.prisma.payment.create({ data: { userId, purpose, refId, amountPaise, orderId } });
    return this.out(p);
  }

  private out(p: { orderId: string; amountPaise: number }) {
    return { orderId: p.orderId, amountPaise: p.amountPaise, currency: 'INR', keyId: this.gateway.keyId };
  }

  /** Client-side confirmation: the app posts the signature Razorpay Checkout returned. */
  async verify(userId: string, orderId: string, paymentId: string, signature: string) {
    const p = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!p || p.userId !== userId) throw new NotFoundException('Order not found');
    if (p.status === 'PAID' || p.status === 'REFUNDED') return { status: p.status, purpose: p.purpose, refId: p.refId };
    if (!safeEq(sign(orderId, paymentId), signature)) throw new BadRequestException('Invalid payment signature');
    // Re-check the record is still payable (e.g. the appointment hold may have expired meanwhile).
    await this.amountFor(userId, p.purpose, p.refId);
    await this.settle(p, paymentId);
    return { status: 'PAID', purpose: p.purpose, refId: p.refId };
  }

  /**
   * Server-side confirmation from Razorpay's `payment.captured` webhook, which still arrives if the
   * app dies after paying. If the record can no longer be paid (hold expired, order cancelled) the
   * captured money is refunded instead of leaving the customer charged for nothing.
   */
  async handleWebhook(rawBody: Buffer, signature: string) {
    if (!rawBody || !safeEq(signWebhook(rawBody), signature)) throw new BadRequestException('Invalid webhook signature');
    const event = JSON.parse(rawBody.toString('utf8'));
    if (event.event !== 'payment.captured') return { ignored: true };
    const entity = event.payload?.payment?.entity;
    const p = entity?.order_id ? await this.prisma.payment.findUnique({ where: { orderId: entity.order_id } }) : null;
    if (!p) return { ignored: true };
    if (p.status !== 'CREATED') return { status: p.status };
    try {
      await this.amountFor(null, p.purpose, p.refId);
    } catch {
      await this.gateway.refund(entity.id, p.amountPaise);
      await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED', paymentId: entity.id } });
      this.log.warn(`refunded late payment ${entity.id} for ${p.purpose} ${p.refId}`);
      return { status: 'REFUNDED' };
    }
    await this.settle(p, entity.id);
    return { status: 'PAID' };
  }

  private async settle(p: Payment, paymentId: string) {
    const settle =
      p.purpose === 'APPOINTMENT'
        ? this.prisma.appointment.update({ where: { id: p.refId }, data: { status: 'CONFIRMED' } })
        : p.purpose === 'LAB_BOOKING'
          ? this.prisma.labBooking.update({ where: { id: p.refId }, data: { status: 'CONFIRMED' } })
          : p.purpose === 'STAFF_VISIT'
            ? this.prisma.staffVisit.update({ where: { id: p.refId }, data: { status: 'CONFIRMED' } })
            : this.prisma.pharmaOrder.update({ where: { id: p.refId }, data: { status: 'paid' } });
    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: p.id }, data: { status: 'PAID', paymentId } }),
      settle,
    ]);
    await this.notifyPaid(p.purpose, p.refId, p.userId);
  }

  /** Refund a paid record (e.g. a cancelled appointment). No-op if it was never paid. */
  async refundFor(purpose: PaymentPurpose, refId: string) {
    const p = await this.prisma.payment.findFirst({ where: { purpose, refId, status: 'PAID' } });
    if (!p?.paymentId) return false;
    await this.gateway.refund(p.paymentId, p.amountPaise);
    await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
    await this.notifications.notify(p.userId, 'Refund initiated', 'Your payment will be refunded to the original payment method.');
    return true;
  }

  /** Tell the payer it worked and the provider that there is new work. */
  private async notifyPaid(purpose: PaymentPurpose, refId: string, payerId: string) {
    let providerId: string | undefined;
    let what = '';
    if (purpose === 'APPOINTMENT') {
      const a = await this.prisma.appointment.findUnique({ where: { id: refId }, include: { doctor: true } });
      providerId = a?.doctor.userId;
      what = `appointment on ${a?.date.toISOString().slice(0, 10)} at ${a?.slot}`;
    } else if (purpose === 'LAB_BOOKING') {
      providerId = (await this.prisma.labBooking.findUnique({ where: { id: refId }, include: { lab: true } }))?.lab.userId;
      what = 'lab test booking';
    } else if (purpose === 'STAFF_VISIT') {
      providerId = (await this.prisma.staffVisit.findUnique({ where: { id: refId }, include: { staff: true } }))?.staff.userId;
      what = 'home visit';
    } else {
      providerId = (await this.prisma.pharmaOrder.findUnique({ where: { id: refId }, include: { pharma: true } }))?.pharma.userId;
      what = 'medicine order';
    }
    await this.notifications.notify(payerId, 'Payment received', `Your ${what} is confirmed.`);
    if (providerId) await this.notifications.notify(providerId, 'New paid booking', `You have a new ${what}.`);
  }
}
