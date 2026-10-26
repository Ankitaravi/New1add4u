import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, login, makeApp, nextDow, razorpaySig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');
const u2 = bearer('test_token_456');
const doc = bearer('doc_token_123');
const doc2 = bearer('doc2_token');
let doctorId: string;
const monday = nextDow(1);

beforeAll(async () => {
  app = await makeApp();
  await http().patch('/doctors/profile').set(doc).send({ specialization: 'Cardiology', feePaise: 50000 });
  await http().put('/doctors/availability').set(doc).send({ days: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }] });
  doctorId = (await http().get('/doctors/profile').set(doc)).body.id;
});
afterAll(async () => { await app.close(); });

const book = (auth: any, slot: string, date = monday) =>
  http().post('/appointments/book').set(auth).send({ doctorId, date, slot });

describe('Slots', () => {
  it('lists 15-minute slots with price', async () => {
    const r = await http().get(`/appointments/slots/${doctorId}?date=${monday}`).set(u1).expect(200);
    expect(r.body.slots).toEqual(['09:00', '09:15', '09:30', '09:45']);
    expect(r.body.price).toEqual({ feePaise: 50000, mdrPaise: 1000, totalPaise: 51000 });
  });
  it('no slots on a non-working day', async () => {
    await http().get(`/appointments/slots/${doctorId}?date=${nextDow(2)}`).set(u1).expect(200).expect((x) => expect(x.body.slots).toEqual([]));
  });
  it('no slots in the past', () =>
    http().get(`/appointments/slots/${doctorId}?date=2020-01-06`).set(u1).expect(200).expect((x) => expect(x.body.slots).toEqual([])));
  it('validates date / unknown / unverified doctor', async () => {
    await http().get(`/appointments/slots/${doctorId}?date=bad`).set(u1).expect(400);
    await http().get(`/appointments/slots/nope?date=${monday}`).set(u1).expect(404);
    const un = (await http().get('/doctors/profile').set(doc2)).body.id;
    await http().get(`/appointments/slots/${un}?date=${monday}`).set(u1).expect(404);
  });
});

describe('Booking + payment', () => {
  let apptId: string;
  it('books a slot as PENDING_PAYMENT with MDR', async () => {
    const r = await book(u1, '09:00').expect(201);
    apptId = r.body.id;
    expect(r.body).toMatchObject({ status: 'PENDING_PAYMENT', feePaise: 50000, mdrPaise: 1000, totalPaise: 51000, slot: '09:00' });
  });
  it('held slot disappears from slot list and cannot be double-booked', async () => {
    await http().get(`/appointments/slots/${doctorId}?date=${monday}`).set(u1).expect((x) => expect(x.body.slots).not.toContain('09:00'));
    await book(u2, '09:00').expect(409);
  });
  it('concurrent bookings of one slot: exactly one wins', async () => {
    const rs = await Promise.all([book(u1, '09:45'), book(u2, '09:45'), book(u1, '09:45')]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });
  it('rejects bad slot, off-schedule slot, past date, doctors booking', async () => {
    await book(u1, '9:00').expect(400);
    await book(u1, '11:00').expect(409);
    await book(u1, '09:00', '2020-01-06').expect(400);
    await book(doc, '09:15').expect(403);
  });
  it('create-order rejects other users and tampered signature', async () => {
    await http().post('/payments/create-order').set(u2).send({ purpose: 'APPOINTMENT', refId: apptId }).expect(404);
    const o = await http().post('/payments/create-order').set(u1).send({ purpose: 'APPOINTMENT', refId: apptId }).expect(201);
    expect(o.body.amountPaise).toBe(51000);
    await http().post('/payments/verify').set(u1).send({ orderId: o.body.orderId, paymentId: 'pay_1', signature: 'deadbeef' }).expect(400);
    await http().post('/payments/verify').set(u2).send({ orderId: o.body.orderId, paymentId: 'pay_1', signature: razorpaySig(o.body.orderId, 'pay_1') }).expect(404);
    await http().get(`/appointments/${apptId}`).set(u1).expect((x) => expect(x.body.status).toBe('PENDING_PAYMENT'));
  });
  it('create-order is idempotent while unpaid', async () => {
    const a = await http().post('/payments/create-order').set(u1).send({ purpose: 'APPOINTMENT', refId: apptId });
    const b = await http().post('/payments/create-order').set(u1).send({ purpose: 'APPOINTMENT', refId: apptId });
    expect(a.body.orderId).toBe(b.body.orderId);
  });
  it('valid signature confirms the appointment; verify is idempotent; cannot pay twice', async () => {
    const o = await http().post('/payments/create-order').set(u1).send({ purpose: 'APPOINTMENT', refId: apptId });
    const body = { orderId: o.body.orderId, paymentId: 'pay_ok', signature: razorpaySig(o.body.orderId, 'pay_ok') };
    await http().post('/payments/verify').set(u1).send(body).expect(201).expect((x) => expect(x.body.status).toBe('PAID'));
    await http().post('/payments/verify').set(u1).send(body).expect(201);
    await http().get(`/appointments/${apptId}`).set(u1).expect((x) => expect(x.body.status).toBe('CONFIRMED'));
    await http().post('/payments/create-order').set(u1).send({ purpose: 'APPOINTMENT', refId: apptId }).expect(400);
  });
  it('appears in my list and the doctor schedule; hidden from others', async () => {
    await http().get('/appointments/my').set(u1).expect((x) => expect(x.body.some((a: any) => a.id === apptId)).toBe(true));
    await http().get(`/doctors/schedule?date=${monday}`).set(doc).expect((x) => expect(x.body.map((a: any) => a.id)).toContain(apptId));
    await http().get(`/appointments/${apptId}`).set(u2).expect(404);
    await http().get(`/appointments/${apptId}`).set(doc).expect(200);
  });
  it('doctor flow: CONFIRMED -> IN_QUEUE -> COMPLETED, then terminal', async () => {
    await http().patch(`/appointments/${apptId}/status`).set(u1).send({ status: 'IN_QUEUE' }).expect(403);
    await http().patch(`/appointments/${apptId}/status`).set(doc2).send({ status: 'IN_QUEUE' }).expect(404);
    await http().patch(`/appointments/${apptId}/status`).set(doc).send({ status: 'IN_QUEUE' }).expect(200);
    await http().patch(`/appointments/${apptId}/status`).set(doc).send({ status: 'COMPLETED' }).expect(200);
    await http().patch(`/appointments/${apptId}/status`).set(doc).send({ status: 'NO_SHOW' }).expect(400);
    await http().patch(`/appointments/${apptId}/cancel`).set(u1).expect(400);
  });
});

describe('Cancel + expiry', () => {
  it('cancelling frees the slot', async () => {
    const a = await book(u2, '09:15').expect(201);
    await http().patch(`/appointments/${a.body.id}/cancel`).set(u1).expect(404);
    await http().patch(`/appointments/${a.body.id}/cancel`).set(u2).expect(200).expect((x) => expect(x.body.status).toBe('CANCELLED'));
    await book(u1, '09:15').expect(201);
  });
  it('unpaid holds expire and release the slot; paying an expired one fails', async () => {
    const a = await book(u2, '09:30').expect(201);
    const o = await http().post('/payments/create-order').set(u2).send({ purpose: 'APPOINTMENT', refId: a.body.id });
    const prisma = app.get(PrismaService);
    await prisma.appointment.update({ where: { id: a.body.id }, data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });
    await http().get(`/appointments/${a.body.id}`).set(u2).expect((x) => expect(x.body.status).toBe('EXPIRED'));
    await http().post('/payments/verify').set(u2)
      .send({ orderId: o.body.orderId, paymentId: 'late', signature: razorpaySig(o.body.orderId, 'late') }).expect(400);
    await book(u1, '09:30').expect(201);
  });
});
