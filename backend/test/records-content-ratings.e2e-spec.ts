import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, login, makeApp, nextDow, razorpaySig } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');
const u2 = bearer('test_token_456');
const doc = bearer('doc_token_123');
const doc2 = bearer('doc2_token');
const stu = bearer('student_token_123');
const hadmin = bearer('hadmin_token_123');
const admin = bearer('admin_token_123');

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Health records', () => {
  let id: string;
  it('creates, validates, lists with kind filter', async () => {
    await http().post('/health-records').set(u1).send({ title: 'BP', kind: 'xray-ish' }).expect(400);
    await http().post('/health-records').set(u1).send({ kind: 'vitals' }).expect(400);
    const r = await http().post('/health-records').set(u1).send({ title: 'BP reading', kind: 'vitals', data: { sys: 120, dia: 80 } }).expect(201);
    id = r.body.id;
    await http().post('/health-records').set(u1).send({ title: 'Penicillin', kind: 'allergy' }).expect(201);
    await http().get('/health-records').set(u1).expect((x) => expect(x.body).toHaveLength(2));
    await http().get('/health-records?kind=vitals').set(u1).expect((x) => expect(x.body.map((r: any) => r.id)).toEqual([id]));
  });
  it('is private to the owner', async () => {
    await http().get(`/health-records/${id}`).set(u1).expect(200).expect((x) => expect(x.body.data.sys).toBe(120));
    await http().get(`/health-records/${id}`).set(u2).expect(404);
    await http().delete(`/health-records/${id}`).set(u2).expect(404);
    await http().get('/health-records').set(u2).expect((x) => expect(x.body).toHaveLength(0));
    await http().delete(`/health-records/${id}`).set(u1).expect(200);
    await http().get(`/health-records/${id}`).set(u1).expect(404);
  });
});

describe('Articles + moderation', () => {
  const art = { title: 'Managing hypertension', body: 'Reduce salt, exercise daily, take medicines on time.' };
  let id: string;
  it('who can write', async () => {
    await http().post('/content/articles').set(u1).send(art).expect(403);
    await http().post('/content/articles').set(doc2).send(art).expect(403); // unverified doctor
    await http().post('/content/articles').set(doc).send({ title: 'x', body: 'short' }).expect(400);
    id = (await http().post('/content/articles').set(doc).send(art).expect(201)).body.id;
    await http().post('/content/articles').set(stu).send({ title: 'Study notes', body: 'Cardiac cycle summary for revision.' }).expect(201);
  });
  it('pending articles are hidden from the public but visible to author/admins', async () => {
    await http().get('/content/articles').set(u1).expect((x) => expect(x.body).toHaveLength(0));
    await http().get(`/content/articles/${id}`).set(u1).expect(404);
    await http().get(`/content/articles/${id}`).set(doc).expect(200);
    await http().get(`/content/articles/${id}`).set(hadmin).expect(200);
    await http().get('/content/articles/mine').set(doc).expect((x) => expect(x.body).toHaveLength(1));
  });
  it('only admins moderate; reject needs a note', async () => {
    await http().get('/content/articles/pending').set(doc).expect(403);
    await http().get('/content/articles/pending').set(hadmin).expect((x) => expect(x.body).toHaveLength(2));
    await http().patch(`/content/articles/${id}/moderate`).set(doc).send({ status: 'APPROVED' }).expect(403);
    await http().patch(`/content/articles/${id}/moderate`).set(hadmin).send({ status: 'REJECTED' }).expect(400);
    await http().patch(`/content/articles/${id}/moderate`).set(hadmin).send({ status: 'MAYBE' }).expect(400);
    await http().patch(`/content/articles/${id}/moderate`).set(hadmin).send({ status: 'REJECTED', note: 'Add references' }).expect(200);
    await http().get(`/content/articles/${id}`).set(u1).expect(404);
  });
  it('author edit resubmits; approval publishes it (super admin may also moderate)', async () => {
    await http().patch(`/content/articles/${id}`).set(u1).send({ title: 'hijack' }).expect(404);
    await http().patch(`/content/articles/${id}`).set(doc).send({ body: 'Reduce salt, exercise daily, take medicines on time. Sources: WHO.' })
      .expect(200).expect((x) => { expect(x.body.status).toBe('PENDING'); expect(x.body.moderationNote).toBeNull(); });
    await http().patch(`/content/articles/${id}/moderate`).set(admin).send({ status: 'APPROVED' }).expect(200);
    await http().get('/content/articles').set(u1).expect((x) => expect(x.body.map((a: any) => a.id)).toEqual([id]));
    await http().get('/content/articles?q=SALT').set(u1).expect((x) => expect(x.body).toHaveLength(1));
    await http().get('/content/articles?q=zzz').set(u1).expect((x) => expect(x.body).toHaveLength(0));
    await http().get(`/content/articles/${id}`).set(u1).expect(200).expect((x) => expect(x.body.author.role).toBe('DOCTOR'));
  });
});

describe('Ratings', () => {
  let doctorId: string;
  const monday = nextDow(1, 3);
  let p1: { Authorization: string };
  beforeAll(async () => {
    p1 = bearer(await login(app, '9555555501')); // fresh patient: no history with this doctor
    await http().put('/doctors/availability').set(doc).send({ days: [{ dayOfWeek: 1, startTime: '14:00', endTime: '15:00' }] });
    doctorId = (await http().get('/doctors/profile').set(doc)).body.id;
  });
  it('cannot rate without a completed appointment', () =>
    http().post('/ratings').set(p1).send({ doctorId, stars: 5 }).expect(400));
  it('after completion: rate, validate, update (one rating per patient), aggregate', async () => {
    const a = await http().post('/appointments/book').set(p1).send({ doctorId, date: monday, slot: '14:00' }).expect(201);
    const o = await http().post('/payments/create-order').set(p1).send({ purpose: 'APPOINTMENT', refId: a.body.id });
    await http().post('/payments/verify').set(p1).send({ orderId: o.body.orderId, paymentId: 'r1', signature: razorpaySig(o.body.orderId, 'r1') }).expect(201);
    await http().patch(`/appointments/${a.body.id}/status`).set(doc).send({ status: 'COMPLETED' }).expect(200);

    await http().post('/ratings').set(p1).send({ doctorId, stars: 6 }).expect(400);
    await http().post('/ratings').set(p1).send({ doctorId, stars: 0 }).expect(400);
    await http().post('/ratings').set(p1).send({ doctorId: 'nope', stars: 4 }).expect(404);
    await http().post('/ratings').set(p1).send({ doctorId, stars: 3, comment: 'ok' }).expect(201);
    await http().post('/ratings').set(p1).send({ doctorId, stars: 5, comment: 'great' }).expect(201);
    await http().get(`/ratings/doctor/${doctorId}`).set(u2).expect(200).expect((x) => {
      expect(x.body.count).toBe(1);
      expect(x.body.average).toBe(5);
      expect(x.body.ratings[0].comment).toBe('great');
    });
    await http().post('/ratings').set(u2).send({ doctorId, stars: 1 }).expect(400); // u2 never completed one
  });
  it('empty rating summary; unknown doctor 404', async () => {
    const other = (await http().get('/doctors/profile').set(doc2)).body.id;
    await http().get(`/ratings/doctor/${other}`).set(p1).expect((x) => expect(x.body).toMatchObject({ average: null, count: 0, ratings: [] }));
    await http().get('/ratings/doctor/nope').set(p1).expect(404);
  });
});
