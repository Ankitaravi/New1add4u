import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, login, makeApp, makeProvider, pushLog, razorpaySig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
let ph: { Authorization: string };
const TOKEN = 'fcm-token-for-patient-aaaaaaaa';
let t: string;

beforeAll(async () => {
  app = await makeApp();
  t = await login(app, '9444444401');
  // a dedicated pharmacy account so other suites' seeded pharmacies stay untouched
  ph = await makeProvider(app, '9444444402', 'PHARMA');
});
afterAll(async () => { await app.close(); });

describe('Notifications', () => {
  it('registers device tokens (validated)', async () => {
    await http().post('/notifications/device-token').set(bearer(t)).send({ token: 'short', platform: 'android' }).expect(400);
    await http().post('/notifications/device-token').set(bearer(t)).send({ token: TOKEN, platform: 'blackberry' }).expect(400);
    await http().post('/notifications/device-token').set(bearer(t)).send({ token: TOKEN, platform: 'android' }).expect(201);
    await http().post('/notifications/device-token').set(bearer(t)).send({ token: TOKEN, platform: 'android' }).expect(201); // idempotent
  });

  it('a business event stores a notification and pushes it to the user device', async () => {
    const pharmaId = (await http().put('/pharma/profile').set(ph).send({ name: 'Push Pharmacy' })).body.id;
    const o = await http().post('/pharma-orders').set(bearer(t)).send({ pharmaId, items: [{ name: 'ORS', qty: 1 }] }).expect(201);
    pushLog.length = 0;
    await http().post(`/pharma-orders/${o.body.id}/quote`).set(ph).send({ items: [{ name: 'ORS', qty: 1, unitPricePaise: 2000 }] }).expect(201);

    expect(pushLog).toHaveLength(1);
    expect(pushLog[0]).toMatchObject({ tokens: [TOKEN], title: 'Quote received' });
    const r = await http().get('/notifications').set(bearer(t)).expect(200);
    expect(r.body.unreadCount).toBe(1);
    expect(r.body.items[0].title).toBe('Quote received');

    // the pharmacy was told about the new request
    await http().get('/notifications').set(ph).expect((x) => expect(x.body.items.map((n: any) => n.title)).toContain('New medicine request'));
  });

  it('payment notifies payer and provider', async () => {
    const pharmaId = (await http().get('/pharma/profile').set(ph)).body.id;
    const o = (await http().post('/pharma-orders').set(bearer(t)).send({ pharmaId, items: [{ name: 'X', qty: 1 }] })).body;
    await http().post(`/pharma-orders/${o.id}/quote`).set(ph).send({ items: [{ name: 'X', qty: 1, unitPricePaise: 1000 }] });
    const pay = await http().post(`/pharma-orders/${o.id}/pay`).set(bearer(t));
    await http().post('/payments/verify').set(bearer(t)).send({ orderId: pay.body.orderId, paymentId: 'n1', signature: razorpaySig(pay.body.orderId, 'n1') }).expect(201);
    await http().get('/notifications').set(bearer(t)).expect((x) => expect(x.body.items.map((n: any) => n.title)).toContain('Payment received'));
    await http().get('/notifications').set(ph).expect((x) => expect(x.body.items.map((n: any) => n.title)).toContain('New paid booking'));
  });

  it('read / read-all / unread filter, scoped to owner', async () => {
    const list = (await http().get('/notifications').set(bearer(t))).body;
    const first = list.items[0].id;
    await http().patch(`/notifications/${first}`).set(bearer('test_token_123')).expect(404);
    await http().patch(`/notifications/${first}`).set(bearer(t)).expect(200);
    await http().get('/notifications?unread=true').set(bearer(t)).expect((x) => expect(x.body.items.every((n: any) => !n.read)).toBe(true));
    await http().patch('/notifications/read-all').set(bearer(t)).expect(200);
    await http().get('/notifications').set(bearer(t)).expect((x) => expect(x.body.unreadCount).toBe(0));
  });

  it('prunes tokens FCM reports as dead, and does not fail the request', async () => {
    await http().post('/notifications/device-token').set(bearer(t)).send({ token: 'dead-token-1234567890', platform: 'ios' }).expect(201);
    const pharmaId = (await http().get('/pharma/profile').set(ph)).body.id;
    const o = (await http().post('/pharma-orders').set(bearer(t)).send({ pharmaId, items: [{ name: 'Y', qty: 1 }] })).body;
    await http().post(`/pharma-orders/${o.id}/reject`).set(ph).expect(201);
    const left = await app.get(PrismaService).deviceToken.findMany({ where: { token: { contains: 'dead' } } });
    expect(left).toHaveLength(0);
    expect(await app.get(PrismaService).deviceToken.count({ where: { token: TOKEN } })).toBe(1);
  });

  it('unregisters a device', async () => {
    await http().delete(`/notifications/device-token/${TOKEN}`).set(bearer(t)).expect(200);
    expect(await app.get(PrismaService).deviceToken.count({ where: { token: TOKEN } })).toBe(0);
  });
});
