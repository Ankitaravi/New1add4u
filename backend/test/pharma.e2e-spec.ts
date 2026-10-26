import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, makeApp, razorpaySig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');
const u2 = bearer('test_token_456');
const ph = bearer('pharma_token_123');
const ph2 = bearer('pharma2_token');
let pharmaId: string, orderId: string;

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

const newOrder = () => http().post('/pharma-orders').set(u1).send({ pharmaId, items: [{ name: 'Paracetamol 500', qty: 2 }, { name: 'ORS', qty: 1 }] });
const quote = (id: string) => http().post(`/pharma-orders/${id}/quote`).set(ph).send({ items: [{ name: 'Paracetamol 500', qty: 2, unitPricePaise: 1500 }, { name: 'ORS', qty: 1, unitPricePaise: 2000 }] });

describe('Pharmacy profile + inventory', () => {
  it('needs profile first; USER forbidden', async () => {
    await http().get('/pharma/inventory').set(ph).expect(404);
    await http().put('/pharma/profile').set(u1).send({ name: 'x' }).expect(403);
  });
  it('creates profile', async () => {
    const r = await http().put('/pharma/profile').set(ph).send({ name: 'Apollo Pharmacy', city: 'Pune' }).expect(200);
    pharmaId = r.body.id;
    await http().put('/pharma/profile').set(ph2).send({ name: 'Other' }).expect(200);
  });
  it('validates item price cap (₹50,000)', async () => {
    await http().post('/pharma/inventory').set(ph).send({ name: 'Gold', unitPricePaise: 5_000_001, stock: 1 }).expect(400);
    await http().post('/pharma/inventory').set(ph).send({ name: 'Max', unitPricePaise: 5_000_000, stock: 1 }).expect(201);
  });
  it('inventory CRUD scoped to owner; public list hides out-of-stock', async () => {
    const a = await http().post('/pharma/inventory').set(ph).send({ name: 'Crocin', unitPricePaise: 3000, stock: 10 }).expect(201);
    const b = await http().post('/pharma/inventory').set(ph).send({ name: 'Zinc', unitPricePaise: 900, stock: 0 }).expect(201);
    await http().patch(`/pharma/inventory/${a.body.id}`).set(ph2).send({ stock: 1 }).expect(404);
    await http().delete(`/pharma/inventory/${a.body.id}`).set(ph2).expect(404);
    await http().patch(`/pharma/inventory/${a.body.id}`).set(ph).send({ stock: 5 }).expect(200);
    const pub = await http().get(`/pharma/${pharmaId}/inventory`).set(u1).expect(200);
    const names = pub.body.map((i: any) => i.name);
    expect(names).toContain('Crocin');
    expect(names).not.toContain('Zinc');
    await http().delete(`/pharma/inventory/${b.body.id}`).set(ph).expect(200);
    await http().get('/pharma').set(u1).expect((x) => expect(x.body.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Apollo Pharmacy', 'Other'])));
  });
});

describe('Order lifecycle: requested -> quoted -> paid -> ready -> completed', () => {
  it('validates and creates request', async () => {
    await http().post('/pharma-orders').set(u1).send({ pharmaId, items: [] }).expect(400);
    await http().post('/pharma-orders').set(u1).send({ pharmaId: 'nope', items: [{ name: 'x', qty: 1 }] }).expect(404);
    await http().post('/pharma-orders').set(ph).send({ pharmaId, items: [{ name: 'x', qty: 1 }] }).expect(403);
    const r = await newOrder().expect(201);
    orderId = r.body.id;
    expect(r.body.status).toBe('requested');
  });
  it('only the owning pharmacy sees and quotes it', async () => {
    await http().get('/pharma-orders/incoming').set(ph).expect((x) => expect(x.body.map((o: any) => o.id)).toContain(orderId));
    await http().get('/pharma-orders/incoming').set(ph2).expect((x) => expect(x.body).toHaveLength(0));
    await http().post(`/pharma-orders/${orderId}/quote`).set(ph2).send({ items: [{ name: 'a', qty: 1, unitPricePaise: 100 }] }).expect(404);
    await http().post(`/pharma-orders/${orderId}/quote`).set(u1).send({ items: [{ name: 'a', qty: 1, unitPricePaise: 100 }] }).expect(403);
    await http().get(`/pharma-orders/${orderId}`).set(u2).expect(404);
  });
  it('cannot pay before a quote', () => http().post(`/pharma-orders/${orderId}/pay`).set(u1).expect(400));
  it('quote validates prices and computes total', async () => {
    await http().post(`/pharma-orders/${orderId}/quote`).set(ph).send({ items: [{ name: 'a', qty: 1, unitPricePaise: 5_000_001 }] }).expect(400);
    const r = await quote(orderId).expect(201);
    expect(r.body).toMatchObject({ status: 'quoted', totalPaise: 5000 });
    await quote(orderId).expect(400);
  });
  it('pay: amount includes 2% MDR; bad sig rejected; good sig -> paid', async () => {
    const o = await http().post(`/pharma-orders/${orderId}/pay`).set(u1).expect(201);
    expect(o.body.amountPaise).toBe(5100);
    await http().post('/payments/verify').set(u1).send({ orderId: o.body.orderId, paymentId: 'p', signature: 'x' }).expect(400);
    await http().post('/payments/verify').set(u1).send({ orderId: o.body.orderId, paymentId: 'p', signature: razorpaySig(o.body.orderId, 'p') }).expect(201);
    await http().get(`/pharma-orders/${orderId}`).set(u1).expect((x) => expect(x.body.status).toBe('paid'));
    await http().patch(`/pharma-orders/${orderId}/cancel`).set(u1).expect(400);
  });
  it('pharmacy: paid -> ready -> completed, no skipping', async () => {
    const s = (status: string) => http().patch(`/pharma-orders/${orderId}/status`).set(ph).send({ status });
    await s('completed').expect(400);
    await s('ready').expect(200);
    await s('completed').expect(200);
    await s('ready').expect(400);
  });
});

describe('Reject / cancel / expire', () => {
  it('pharmacy rejects a request', async () => {
    const o = await newOrder();
    await http().post(`/pharma-orders/${o.body.id}/reject`).set(ph).expect(201).expect((x) => expect(x.body.status).toBe('rejected'));
    await http().post(`/pharma-orders/${o.body.id}/reject`).set(ph).expect(400);
  });
  it('user cancels requested and quoted orders', async () => {
    const a = await newOrder();
    await http().patch(`/pharma-orders/${a.body.id}/cancel`).set(u2).expect(404);
    await http().patch(`/pharma-orders/${a.body.id}/cancel`).set(u1).expect(200);
    const b = await newOrder();
    await quote(b.body.id);
    await http().patch(`/pharma-orders/${b.body.id}/cancel`).set(u1).expect(200).expect((x) => expect(x.body.status).toBe('cancelled'));
  });
  it('a quote older than 24h expires and can no longer be paid', async () => {
    const o = await newOrder();
    await quote(o.body.id);
    await app.get(PrismaService).pharmaOrder.update({ where: { id: o.body.id }, data: { quotedAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    await http().get(`/pharma-orders/${o.body.id}`).set(u1).expect((x) => expect(x.body.status).toBe('expired'));
    await http().post(`/pharma-orders/${o.body.id}/pay`).set(u1).expect(400);
  });
});
