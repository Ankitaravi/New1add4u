import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

export const RAZORPAY_GATEWAY = 'RAZORPAY_GATEWAY';

export interface PaymentGateway {
  keyId: string | null;
  createOrder(amountPaise: number, receipt: string): Promise<string>;
  refund(paymentId: string, amountPaise: number): Promise<void>;
}

/**
 * Talks to Razorpay when RAZORPAY_KEY_ID + RAZORPAY_SECRET are set. Without them
 * (local dev / tests) orders are synthetic and refunds are no-ops; production
 * startup refuses to run without keys (see config.ts).
 */
@Injectable()
export class RazorpayGateway implements PaymentGateway {
  private log = new Logger('Razorpay');

  get keyId() {
    return process.env.RAZORPAY_KEY_ID ?? null;
  }
  private get live() {
    return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_SECRET);
  }
  private async call(path: string, body: unknown): Promise<any> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_SECRET}`).toString('base64'),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      this.log.error(`${path} -> ${res.status} ${await res.text()}`);
      throw new BadRequestException('Payment gateway rejected the request');
    }
    return res.json();
  }

  async createOrder(amountPaise: number, receipt: string) {
    if (!this.live) return 'order_' + randomBytes(8).toString('hex');
    return (await this.call('/orders', { amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40) })).id;
  }

  async refund(paymentId: string, amountPaise: number) {
    if (!this.live) return;
    await this.call(`/payments/${paymentId}/refund`, { amount: amountPaise });
  }
}
