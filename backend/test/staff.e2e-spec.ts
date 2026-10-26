import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, makeApp, razorpaySig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');
const u2 = bearer('test_token_456');
const st = bearer('staff_token_123');
const st2 = bearer('staff2_token');
let staffId: string, visitId: string;
const future = () => new Date(Date.now() + 2 * 86400000).toISOString();

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Staff profile + services', () => {
  it('requires profile first; USER forbidden', async () => {
    await http().get('/staff/services').set(st).expect(404);
    await http().put('/staff/profile').set(u1).send({ name: 'x' }).expect(403);
  });
  it('creates profile and services', async () => {
    staffId = (await http().put('/staff/profile').set(st).send({ name: 'Nurse Asha', city: 'Delhi' }).expect(200)).body.id;
    await http().put('/staff/profile').set(st2).send({ name: 'Nurse Bina', city: 'Mumbai' }).expect(200);
    await http().put('/staff/services').set(st).send({ services: [{ type: 'injection', pricePaise: 20000 }, { type: 'bpSugarCheck', pricePaise: 10000 }] })
      .expect(200).expect((x) => expect(x.body).toHaveLength(2));
  });
  it('validates service type, price cap, duplicates', async () => {
    await http().put('/staff/services').set(st).send({ services: [{ type: 'surgery', pricePaise: 100 }] }).expect(400);
    await http().put('/staff/services').set(st).send({ services: [{ type: 'injection', pricePaise: 5_000_001 }] }).expect(400);
    await http().put('/staff/services').set(st).send({ services: [{ type: 'injection', pricePaise: 1 }, { type: 'injection', pricePaise: 2 }] }).expect(400);
  });
  it('lists / filters staff', async () => {
    await http().get('/staff?service=injection').set(u1).expect((x) => expect(x.body.map((s: any) => s.id)).toEqual([staffId]));
    await http().get('/staff?city=mumbai').set(u1).expect((x) => expect(x.body).toHaveLength(1));
    await http().get('/staff?service=nope').set(u1).expect(400);
  });
});

describe('Home visit flow', () => {
  const body = () => ({ staffId, serviceType: 'injection', address: '12 MG Road, Delhi', scheduledAt: future() });
  it('books with MDR; validates', async () => {
    const r = await http().post('/staff/visits/book').set(u1).send(body()).expect(201);
    visitId = r.body.id;
    expect(r.body).toMatchObject({ status: 'PENDING_PAYMENT', pricePaise: 20000, mdrPaise: 400, totalPaise: 20400 });
    await http().post('/staff/visits/book').set(u1).send({ ...body(), serviceType: 'dressing' }).expect(400);
    await http().post('/staff/visits/book').set(u1).send({ ...body(), scheduledAt: '2020-01-01T10:00:00Z' }).expect(400);
    await http().post('/staff/visits/book').set(u1).send({ ...body(), staffId: 'nope' }).expect(404);
    await http().post('/staff/visits/book').set(st).send(body()).expect(403);
  });
  it('staff does not see unpaid visits; others cannot read/pay', async () => {
    await http().get('/staff/visits/incoming').set(st).expect((x) => expect(x.body).toHaveLength(0));
    await http().get(`/staff/visits/${visitId}`).set(u2).expect(404);
    await http().post(`/staff/visits/${visitId}/pay`).set(u2).expect(404);
    await http().patch(`/staff/visits/${visitId}/status`).set(st).send({ status: 'IN_PROGRESS' }).expect(400);
  });
  it('pay -> CONFIRMED -> IN_PROGRESS -> COMPLETED', async () => {
    const o = await http().post(`/staff/visits/${visitId}/pay`).set(u1).expect(201);
    expect(o.body.amountPaise).toBe(20400);
    await http().post('/payments/verify').set(u1).send({ orderId: o.body.orderId, paymentId: 'sp', signature: razorpaySig(o.body.orderId, 'sp') }).expect(201);
    await http().get('/staff/visits/incoming').set(st).expect((x) => expect(x.body).toHaveLength(1));
    await http().patch(`/staff/visits/${visitId}/cancel`).set(u1).expect(400);
    const s = (a: any, status: string) => http().patch(`/staff/visits/${visitId}/status`).set(a).send({ status });
    await s(st2, 'IN_PROGRESS').expect(404);
    await s(st, 'COMPLETED').expect(400);
    await s(st, 'IN_PROGRESS').expect(200);
    await s(st, 'COMPLETED').expect(200);
    await http().get('/staff/visits/my').set(u1).expect((x) => expect(x.body[0].status).toBe('COMPLETED'));
  });
  it('unpaid visit can be cancelled', async () => {
    const v = await http().post('/staff/visits/book').set(u2).send(body()).expect(201);
    await http().patch(`/staff/visits/${v.body.id}/cancel`).set(u1).expect(404);
    await http().patch(`/staff/visits/${v.body.id}/cancel`).set(u2).expect(200);
  });
});
