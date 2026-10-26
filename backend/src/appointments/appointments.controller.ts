import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get,
  NotFoundException, Param, Patch, Post, Query, Req,
} from '@nestjs/common';
import { IsIn, IsString, Matches } from 'class-validator';
import { Role } from '../generated/prisma/client';
import { Roles } from '../auth/roles';
import { HHMM, PAYMENT_HOLD_MS, fromMins, parseDay, toMins, todayIST } from '../common/dates';
import { priceOf } from '../common/money';
import { APPOINTMENT_DOCTOR_FLOW, assertTransition } from '../common/transitions';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const LIVE = ['PENDING_PAYMENT', 'CONFIRMED', 'IN_QUEUE', 'COMPLETED'] as const;

class BookDto {
  @IsString() doctorId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @Matches(HHMM) slot: string;
}
class StatusDto {
  @IsIn(['IN_QUEUE', 'COMPLETED', 'NO_SHOW']) status: string;
}

@Controller('appointments')
export class AppointmentsController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService, private payments: PaymentsService) {}

  private expireStale() {
    return this.prisma.appointment.updateMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: new Date(Date.now() - PAYMENT_HOLD_MS) } },
      data: { status: 'EXPIRED' },
    });
  }

  private async openSlots(doctorId: string, day: Date): Promise<string[]> {
    const av = await this.prisma.availability.findUnique({
      where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: day.getUTCDay() } },
    });
    if (!av) return [];
    const all: string[] = [];
    for (let m = toMins(av.startTime); m + av.slotMins <= toMins(av.endTime); m += av.slotMins) all.push(fromMins(m));
    const taken = await this.prisma.appointment.findMany({
      where: { doctorId, date: day, status: { in: [...LIVE] } },
      select: { slot: true },
    });
    const set = new Set(taken.map((t) => t.slot));
    return all.filter((s) => !set.has(s));
  }

  @Get('slots/:doctorId')
  async slots(@Param('doctorId') doctorId: string, @Query('date') date: string) {
    const day = parseDay(date);
    const doctor = await this.prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor || !doctor.isVerified) throw new NotFoundException('Doctor not found');
    await this.expireStale();
    const slots = day < todayIST() ? [] : await this.openSlots(doctorId, day);
    return { price: priceOf(doctor.feePaise), slots };
  }

  @Post('book') @Roles(Role.USER)
  async book(@Req() req: any, @Body() b: BookDto) {
    const day = parseDay(b.date);
    if (day < todayIST()) throw new BadRequestException('Cannot book a past date');
    const doctor = await this.prisma.doctor.findUnique({ where: { id: b.doctorId } });
    if (!doctor || !doctor.isVerified) throw new NotFoundException('Doctor not found');
    if (doctor.userId === req.user.id) throw new BadRequestException('Cannot book yourself');
    await this.expireStale();
    if (!(await this.openSlots(doctor.id, day)).includes(b.slot)) {
      throw new ConflictException('Slot not available');
    }
    const price = priceOf(doctor.feePaise);
    try {
      return await this.prisma.appointment.create({
        data: { userId: req.user.id, doctorId: doctor.id, date: day, slot: b.slot, ...price },
      });
    } catch (e: any) {
      // Lost a race for the same slot: the partial unique index rejected the insert.
      if (e?.code === 'P2002' || /unique|duplicate/i.test(String(e?.message))) {
        throw new ConflictException('Slot not available');
      }
      throw e;
    }
  }

  @Get('my')
  async mine(@Req() req: any) {
    await this.expireStale();
    return this.prisma.appointment.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async one(@Req() req: any, @Param('id') id: string) {
    await this.expireStale();
    const a = await this.prisma.appointment.findUnique({ where: { id }, include: { doctor: true } });
    if (!a || (a.userId !== req.user.id && a.doctor.userId !== req.user.id)) {
      throw new NotFoundException('Appointment not found');
    }
    return a;
  }

  @Patch(':id/cancel')
  async cancel(@Req() req: any, @Param('id') id: string) {
    const a = await this.prisma.appointment.findUnique({ where: { id }, include: { doctor: true } });
    if (!a || a.userId !== req.user.id) throw new NotFoundException('Appointment not found');
    if (a.status !== 'PENDING_PAYMENT' && a.status !== 'CONFIRMED') {
      throw new BadRequestException(`Cannot cancel an appointment that is ${a.status}`);
    }
    const u = await this.prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
    if (a.status === 'CONFIRMED') {
      await this.payments.refundFor('APPOINTMENT', id);
      await this.notifications.notify(a.doctor.userId, 'Appointment cancelled', `The ${a.slot} appointment on ${a.date.toISOString().slice(0, 10)} was cancelled.`);
    }
    return u;
  }

  @Patch(':id/status') @Roles(Role.DOCTOR)
  async setStatus(@Req() req: any, @Param('id') id: string, @Body() b: StatusDto) {
    const a = await this.prisma.appointment.findUnique({ where: { id }, include: { doctor: true } });
    if (!a || a.doctor.userId !== req.user.id) throw new NotFoundException('Appointment not found');
    assertTransition(APPOINTMENT_DOCTOR_FLOW, a.status, b.status);
    const u = await this.prisma.appointment.update({ where: { id }, data: { status: b.status as any } });
    await this.notifications.notify(a.userId, 'Appointment update', `Your appointment is now ${b.status.replace('_', ' ').toLowerCase()}.`);
    return u;
  }
}
