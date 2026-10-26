import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { setup } from '../src/setup';
import { PUSH_SENDER, PushSender } from '../src/notifications/push';
import { AI_PROVIDER, AiProvider } from '../src/ai/ai.provider';
import { PaymentGateway, RAZORPAY_GATEWAY } from '../src/payments/razorpay.gateway';
import { ServiceUnavailableException } from '@nestjs/common';

/** Scriptable stand-in for Claude: set `ai.reply` (or `ai.unconfigured`), inspect `ai.calls`. */
export const ai = { reply: '', unconfigured: false, calls: 0 };
const fakeAi: AiProvider = {
  async complete() {
    ai.calls++;
    if (ai.unconfigured) throw new ServiceUnavailableException('AI features are not configured');
    return ai.reply;
  },
};

/** Records gateway calls instead of hitting Razorpay. */
export const gateway = { refunds: [] as { paymentId: string; amountPaise: number }[], orders: 0 };
const fakeGateway: PaymentGateway = {
  keyId: 'rzp_test_key',
  async createOrder() { return `order_fake_${++gateway.orders}_${Math.random().toString(36).slice(2, 8)}`; },
  async refund(paymentId, amountPaise) { gateway.refunds.push({ paymentId, amountPaise }); },
};

/** Captures pushes instead of calling FCM. Tokens containing "dead" are reported as invalid. */
export const pushLog: { tokens: string[]; title: string; body: string }[] = [];
const fakePush: PushSender = {
  async send(tokens, title, body) {
    if (tokens.length) pushLog.push({ tokens, title, body });
    return tokens.filter((t) => t.includes('dead'));
  },
};

export async function makeApp(): Promise<INestApplication> {
  process.env.DATABASE_URL = 'postgresql://add4u:add4u@localhost:5432/add4u_test';
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PUSH_SENDER).useValue(fakePush)
    .overrideProvider(AI_PROVIDER).useValue(fakeAi)
    .overrideProvider(RAZORPAY_GATEWAY).useValue(fakeGateway)
    .compile();
  const app = setup(mod.createNestApplication({ rawBody: true }));
  await app.init();
  return app;
}
export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

import request from 'supertest';
import { createHmac } from 'crypto';

export async function login(app: INestApplication, phone: string): Promise<string> {
  await request(app.getHttpServer()).post('/auth/otp/send').send({ phone });
  const r = await request(app.getHttpServer()).post('/auth/otp/verify').send({ phone, otp: '123456' });
  return r.body.token;
}

/** The next calendar date (YYYY-MM-DD, at least 2 days ahead) falling on the given weekday (0=Sun). */
export function nextDow(dow: number, minDaysAhead = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const razorpaySig = (orderId: string, paymentId: string) =>
  createHmac('sha256', 'test_secret').update(orderId + '|' + paymentId).digest('hex');

export const webhookSig = (raw: string) =>
  createHmac('sha256', 'test_webhook_secret').update(raw).digest('hex');

/**
 * Registers a doctor through the real API, verifies them as super admin, and gives
 * them one availability window (09:00-10:00 on `dow`). Returns their token + doctor id.
 */
export async function makeVerifiedDoctor(app: INestApplication, phone: string, hprId: string, dow: number) {
  const http = () => request(app.getHttpServer());
  const token = await login(app, phone);
  const reg = await http().post('/doctors/register').set(bearer(token))
    .send({ hprId, medicalStream: 'mbbs', specialization: 'General Medicine', feePaise: 50000 }).expect(201);
  await http().patch(`/admin/doctors/${reg.body.id}/verify`).set(bearer('admin_token_123')).send({ verified: true }).expect(200);
  await http().put('/doctors/availability').set(bearer(token))
    .send({ days: [{ dayOfWeek: dow, startTime: '09:00', endTime: '10:00' }] }).expect(200);
  return { token, doctorId: reg.body.id as string, auth: bearer(token) };
}

/** Books the 09:00 slot on `date` as a fresh patient and pays it. */
export async function bookAndPay(app: INestApplication, patientToken: string, doctorId: string, date: string, slot = '09:00') {
  const http = () => request(app.getHttpServer());
  const a = await http().post('/appointments/book').set(bearer(patientToken)).send({ doctorId, date, slot }).expect(201);
  const o = await http().post('/payments/create-order').set(bearer(patientToken)).send({ purpose: 'APPOINTMENT', refId: a.body.id }).expect(201);
  const paymentId = 'pay_' + Math.random().toString(36).slice(2, 10);
  await http().post('/payments/verify').set(bearer(patientToken))
    .send({ orderId: o.body.orderId, paymentId, signature: razorpaySig(o.body.orderId, paymentId) }).expect(201);
  return { appointmentId: a.body.id as string, paymentId, orderId: o.body.orderId as string };
}

/** A fresh account promoted to `role` — for suites that must not touch the shared seeded provider accounts. */
export async function makeProvider(app: INestApplication, phone: string, role: 'PHARMA' | 'INVESTIGATION' | 'STAFF') {
  const token = await login(app, phone);
  const { PrismaService } = await import('../src/prisma/prisma.service');
  await app.get(PrismaService).user.update({ where: { phone }, data: { role } });
  return bearer(token);
}
