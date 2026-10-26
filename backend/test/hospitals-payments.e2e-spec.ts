import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, bookAndPay, gateway, login, makeApp, makeProvider, makeVerifiedDoctor, nextDow, webhookSig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const ha = bearer('hadmin_token_123');
const ha2 = bearer('hadmin2_token');
const admin = bearer('admin_token_123');

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Hospital admin', () => {
  let doc: Awaited<ReturnType<typeof makeVerifiedDoctor>>;
  const saturday = nextDow(6, 3);
  beforeAll(async () => { doc = await makeVerifiedDoctor(app, '9999999901', '71000000009901', 6); });

  it('needs a profile first; others forbidden', async () => {
    await http().get('/hospitals/doctors').set(ha).expect(404);
    await http().put('/hospitals/profile').set(bearer('test_token_123')).send({ name: 'x' }).expect(403);
    await http().put('/hospitals/profile').set(ha).send({ name: 'x' }).expect(400);
  });
  it('profile + departments scoped to own hospital', async () => {
    const h = await http().put('/hospitals/profile').set(ha).send({ name: 'City General', city: 'Delhi' }).expect(200);
    await http().put('/hospitals/profile').set(ha).send({ name: 'City General Hospital' }).expect(200).expect((x) => expect(x.body.id).toBe(h.body.id));
    await http().put('/hospitals/profile').set(ha2).send({ name: 'Other Hospital' }).expect(200);
    const d = await http().post('/hospitals/departments').set(ha).send({ name: 'Cardiology' }).expect(201);
    await http().delete(`/hospitals/departments/${d.body.id}`).set(ha2).expect(404);
    await http().get('/hospitals/departments').set(ha).expect((x) => expect(x.body).toHaveLength(1));
    await http().get(`/hospitals/${h.body.id}`).set(bearer('test_token_123')).expect(200).expect((x) => expect(x.body.departments).toHaveLength(1));
    await http().get('/hospitals/nope').set(bearer('test_token_123')).expect(404);
  });
  it('links doctors by HPR id: verified only, one hospital at a time', async () => {
    await http().post('/hospitals/doctors').set(ha).send({ hprId: '123' }).expect(400);
    await http().post('/hospitals/doctors').set(ha).send({ hprId: '71999999999999' }).expect(404);
    const t = await login(app, '9999999902'); // registered but unverified
    await http().post('/doctors/register').set(bearer(t)).send({ hprId: '71000000009902', medicalStream: 'mbbs', specialization: 'x', feePaise: 100 }).expect(201);
    await http().post('/hospitals/doctors').set(ha).send({ hprId: '71000000009902' }).expect(404);

    await http().post('/hospitals/doctors').set(ha).send({ hprId: '71-0000-0000-9901' }).expect(201);
    await http().post('/hospitals/doctors').set(ha).send({ hprId: '71000000009901' }).expect(201); // idempotent for same hospital
    await http().post('/hospitals/doctors').set(ha2).send({ hprId: '71000000009901' }).expect(409);
    await http().get('/hospitals/doctors').set(ha).expect((x) => expect(x.body.map((d: any) => d.id)).toEqual([doc.doctorId]));
    await http().delete(`/hospitals/doctors/${doc.doctorId}`).set(ha2).expect(404);
  });
  it('dashboard: stats and daily appointments reflect paid bookings', async () => {
    await http().get('/hospitals/stats').set(ha).expect((x) => expect(x.body).toMatchObject({ doctors: 1, appointments: 0, revenuePaise: 0 }));
    const patient = await login(app, '9999999903');
    await bookAndPay(app, patient, doc.doctorId, saturday);
    const unpaid = await login(app, '9999999904');
    await http().post('/appointments/book').set(bearer(unpaid)).send({ doctorId: doc.doctorId, date: saturday, slot: '09:15' }).expect(201);

    const s = await http().get('/hospitals/stats').set(ha).expect(200);
    expect(s.body.appointments).toBe(2);
    expect(s.body.byStatus).toEqual({ CONFIRMED: 1, PENDING_PAYMENT: 1 });
    expect(s.body.revenuePaise).toBe(51000); // only the paid one, fee + 2% MDR
    await http().get('/hospitals/stats').set(ha2).expect((x) => expect(x.body).toMatchObject({ doctors: 0, appointments: 0 }));

    await http().get('/hospitals/appointments?date=bad').set(ha).expect(400);
    const day = await http().get(`/hospitals/appointments?date=${saturday}`).set(ha).expect(200);
    expect(day.body).toHaveLength(1);
    expect(day.body[0]).toMatchObject({ slot: '09:00', status: 'CONFIRMED' });
    await http().get(`/hospitals/appointments?date=${saturday}`).set(ha2).expect((x) => expect(x.body).toHaveLength(0));
  });
  it('unlinking removes the doctor from the dashboard', async () => {
    await http().delete(`/hospitals/doctors/${doc.doctorId}`).set(ha).expect(200);
    await http().get('/hospitals/stats').set(ha).expect((x) => expect(x.body.doctors).toBe(0));
  });
});

describe('Refunds on cancel', () => {
  it('cancelling a paid appointment refunds it through the gateway and notifies the patient', async () => {
    const doc = await makeVerifiedDoctor(app, '9999999911', '71000000009911', 0);
    const patient = await login(app, '9999999912');
    const sunday = nextDow(0, 3);
    const { appointmentId, paymentId } = await bookAndPay(app, patient, doc.doctorId, sunday);
    gateway.refunds.length = 0;
    await http().patch(`/appointments/${appointmentId}/cancel`).set(bearer(patient)).expect(200);
    expect(gateway.refunds).toEqual([{ paymentId, amountPaise: 51000 }]);
    const p = await app.get(PrismaService).payment.findFirst({ where: { refId: appointmentId } });
    expect(p?.status).toBe('REFUNDED');
    await http().get('/notifications').set(bearer(patient)).expect((x) => expect(x.body.items.map((n: any) => n.title)).toContain('Refund initiated'));
    // the slot is free again
    await http().get(`/appointments/slots/${doc.doctorId}?date=${sunday}`).set(bearer(patient)).expect((x) => expect(x.body.slots).toContain('09:00'));
  });
  it('cancelling an unpaid appointment triggers no refund', async () => {
    const doc = await makeVerifiedDoctor(app, '9999999913', '71000000009913', 0);
    const patient = await login(app, '9999999914');
    const a = await http().post('/appointments/book').set(bearer(patient)).send({ doctorId: doc.doctorId, date: nextDow(0, 3), slot: '09:00' }).expect(201);
    gateway.refunds.length = 0;
    await http().patch(`/appointments/${a.body.id}/cancel`).set(bearer(patient)).expect(200);
    expect(gateway.refunds).toHaveLength(0);
  });
});

describe('Razorpay webhook', () => {
  let ph: { Authorization: string };
  let pharmaId: string, patient: string;
  const post = (raw: string, sig = webhookSig(raw)) =>
    http().post('/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).send(raw);
  const captured = (orderId: string, paymentId: string) =>
    JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });

  /** A quoted pharma order with a payment order created, ready for the gateway to capture. */
  async function quotedOrder() {
    const o = (await http().post('/pharma-orders').set(bearer(patient)).send({ pharmaId, items: [{ name: 'ORS', qty: 1 }] })).body;
    await http().post(`/pharma-orders/${o.id}/quote`).set(ph).send({ items: [{ name: 'ORS', qty: 1, unitPricePaise: 5000 }] }).expect(201);
    const pay = (await http().post(`/pharma-orders/${o.id}/pay`).set(bearer(patient)).expect(201)).body;
    return { id: o.id as string, orderId: pay.orderId as string };
  }

  beforeAll(async () => {
    patient = await login(app, '9999999921');
    ph = await makeProvider(app, '9999999922', 'PHARMA');
    pharmaId = (await http().put('/pharma/profile').set(ph).send({ name: 'Webhook Pharmacy' }).expect(200)).body.id;
  });

  it('rejects missing / wrong signatures (the endpoint is public, so this is the only gate)', async () => {
    const raw = captured('order_x', 'pay_x');
    await post(raw, 'deadbeef').expect(400);
    await http().post('/payments/webhook').set('Content-Type', 'application/json').send(raw).expect(400);
    await post(raw, webhookSig(raw + ' ')).expect(400);
  });
  it('ignores other events and unknown orders', async () => {
    await post(JSON.stringify({ event: 'payment.failed', payload: {} })).expect(200).expect((x) => expect(x.body.ignored).toBe(true));
    await post(captured('order_unknown', 'pay_u')).expect(200).expect((x) => expect(x.body.ignored).toBe(true));
  });
  it('payment.captured settles the order even though the app never called /verify; redelivery is harmless', async () => {
    const { id, orderId } = await quotedOrder();
    await post(captured(orderId, 'pay_wh1')).expect(200).expect((x) => expect(x.body.status).toBe('PAID'));
    await http().get(`/pharma-orders/${id}`).set(bearer(patient)).expect((x) => expect(x.body.status).toBe('paid'));
    await post(captured(orderId, 'pay_wh1')).expect(200).expect((x) => expect(x.body.status).toBe('PAID'));
    const p = await app.get(PrismaService).payment.findUnique({ where: { orderId } });
    expect(p).toMatchObject({ status: 'PAID', paymentId: 'pay_wh1' });
  });
  it('money captured for a no-longer-payable order is refunded, not kept', async () => {
    const { id, orderId } = await quotedOrder();
    await http().patch(`/pharma-orders/${id}/cancel`).set(bearer(patient)).expect(200); // user cancelled while the checkout was open
    gateway.refunds.length = 0;
    await post(captured(orderId, 'pay_late')).expect(200).expect((x) => expect(x.body.status).toBe('REFUNDED'));
    expect(gateway.refunds).toEqual([{ paymentId: 'pay_late', amountPaise: 5100 }]);
    await http().get(`/pharma-orders/${id}`).set(bearer(patient)).expect((x) => expect(x.body.status).toBe('cancelled'));
  });
  it('create-order returns the gateway key id for Checkout', async () => {
    const { orderId } = await quotedOrder();
    expect(orderId).toMatch(/^order_fake_/);
  });
});
