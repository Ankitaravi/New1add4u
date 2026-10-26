import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, makeApp, razorpaySig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');
const u2 = bearer('test_token_456');
const lab = bearer('lab_token_123');
const lab2 = bearer('lab2_token');
let labId: string, testId: string, bookingId: string;

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Lab profile + tests', () => {
  it('needs a profile before adding tests', () =>
    http().post('/labs/tests').set(lab).send({ type: 'cbc', name: 'CBC', pricePaise: 35000 }).expect(404));
  it('USER cannot manage labs', () => http().put('/labs/profile').set(u1).send({ name: 'x' }).expect(403));
  it('creates/updates profile (upsert)', async () => {
    const r = await http().put('/labs/profile').set(lab).send({ name: 'City Lab', city: 'Delhi' }).expect(200);
    labId = r.body.id;
    await http().put('/labs/profile').set(lab).send({ name: 'City Lab 2' }).expect(200).expect((x) => expect(x.body.id).toBe(labId));
    await http().get('/labs/profile').set(lab).expect((x) => expect(x.body.name).toBe('City Lab 2'));
  });
  it('validates test type and price cap', async () => {
    await http().post('/labs/tests').set(lab).send({ type: 'mri', name: 'x', pricePaise: 100 }).expect(400);
    await http().post('/labs/tests').set(lab).send({ type: 'cbc', name: 'x', pricePaise: 5_000_001 }).expect(400);
    await http().post('/labs/tests').set(lab).send({ type: 'cbc', name: 'x', pricePaise: 0 }).expect(400);
  });
  it('adds a test, visible publicly under the lab', async () => {
    const r = await http().post('/labs/tests').set(lab).send({ type: 'cbc', name: 'CBC', pricePaise: 35000 }).expect(201);
    testId = r.body.id;
    await http().get(`/labs/${labId}/tests`).set(u1).expect((x) => expect(x.body.map((t: any) => t.id)).toContain(testId));
    await http().get('/labs').set(u1).expect((x) => expect(x.body.some((l: any) => l.id === labId)).toBe(true));
    await http().get('/labs/nope/tests').set(u1).expect(404);
  });
  it('other labs cannot edit or delete it', async () => {
    await http().put('/labs/profile').set(lab2).send({ name: 'Other' }).expect(200);
    await http().patch(`/labs/tests/${testId}`).set(lab2).send({ pricePaise: 1 }).expect(404);
    await http().delete(`/labs/tests/${testId}`).set(lab2).expect(404);
    await http().patch(`/labs/tests/${testId}`).set(lab).send({ pricePaise: 40000 }).expect(200).expect((x) => expect(x.body.pricePaise).toBe(40000));
  });
});

describe('Lab booking flow', () => {
  it('books with MDR', async () => {
    const r = await http().post('/lab-bookings/book').set(u1).send({ testId }).expect(201);
    bookingId = r.body.id;
    expect(r.body).toMatchObject({ status: 'PENDING_PAYMENT', pricePaise: 40000, mdrPaise: 800, totalPaise: 40800 });
    await http().post('/lab-bookings/book').set(u1).send({ testId: 'nope' }).expect(404);
    await http().post('/lab-bookings/book').set(lab).send({ testId }).expect(403);
  });
  it('lab does not see unpaid bookings; other users cannot pay', async () => {
    await http().get('/lab-bookings/incoming').set(lab).expect((x) => expect(x.body).toHaveLength(0));
    await http().post(`/lab-bookings/${bookingId}/pay`).set(u2).expect(404);
    await http().get(`/lab-bookings/${bookingId}`).set(u2).expect(404);
  });
  it('cannot advance before payment', () =>
    http().patch(`/lab-bookings/${bookingId}/status`).set(lab).send({ status: 'SAMPLE_COLLECTED' }).expect(400));
  it('pays via /pay + verify -> CONFIRMED', async () => {
    const o = await http().post(`/lab-bookings/${bookingId}/pay`).set(u1).expect(201);
    expect(o.body.amountPaise).toBe(40800);
    await http().post('/payments/verify').set(u1).send({ orderId: o.body.orderId, paymentId: 'p1', signature: 'bad' }).expect(400);
    await http().post('/payments/verify').set(u1).send({ orderId: o.body.orderId, paymentId: 'p1', signature: razorpaySig(o.body.orderId, 'p1') }).expect(201);
    await http().get(`/lab-bookings/${bookingId}`).set(u1).expect((x) => expect(x.body.status).toBe('CONFIRMED'));
    await http().get('/lab-bookings/incoming').set(lab).expect((x) => expect(x.body).toHaveLength(1));
    await http().patch(`/lab-bookings/${bookingId}/cancel`).set(u1).expect(400);
  });
  it('lab walks CONFIRMED -> SAMPLE_COLLECTED -> REPORT_UPLOADED -> COMPLETED', async () => {
    const s = (a: any, body: any) => http().patch(`/lab-bookings/${bookingId}/status`).set(a).send(body);
    await s(lab2, { status: 'SAMPLE_COLLECTED' }).expect(404);
    await s(u1, { status: 'SAMPLE_COLLECTED' }).expect(403);
    await s(lab, { status: 'COMPLETED' }).expect(400);
    await s(lab, { status: 'SAMPLE_COLLECTED' }).expect(200);
    await s(lab, { status: 'REPORT_UPLOADED' }).expect(400);
    await s(lab, { status: 'REPORT_UPLOADED', reportUrl: 'https://files.example.com/r1.pdf' }).expect(200);
    await s(lab, { status: 'COMPLETED' }).expect(200);
    await http().get('/lab-bookings/my').set(u1).expect((x) => expect(x.body[0].reportUrl).toBe('https://files.example.com/r1.pdf'));
  });
  it('unpaid booking can be cancelled; tests with bookings cannot be deleted', async () => {
    const b = await http().post('/lab-bookings/book').set(u2).send({ testId }).expect(201);
    await http().patch(`/lab-bookings/${b.body.id}/cancel`).set(u2).expect(200).expect((x) => expect(x.body.status).toBe('CANCELLED'));
    await http().delete(`/labs/tests/${testId}`).set(lab).expect(409);
  });
});
