import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, login, makeApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const doc = bearer('doc_token_123');
const HPR = '71123456789012';

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Doctor registration', () => {
  let t: string;
  beforeAll(async () => { t = await login(app, '9333333301'); });

  it('rejects short HPR', () =>
    http().post('/doctors/register').set(bearer(t)).send({ hprId: '1234', medicalStream: 'mbbs', specialization: 'GP', feePaise: 50000 }).expect(400));
  it('rejects bad stream', () =>
    http().post('/doctors/register').set(bearer(t)).send({ hprId: HPR, medicalStream: 'xyz', specialization: 'GP', feePaise: 50000 }).expect(400));
  it('rejects fee above ₹50,000', () =>
    http().post('/doctors/register').set(bearer(t)).send({ hprId: HPR, medicalStream: 'mbbs', specialization: 'GP', feePaise: 5_000_001 }).expect(400));
  it('registers (hyphenated HPR ok), becomes DOCTOR, unverified', async () => {
    const r = await http().post('/doctors/register').set(bearer(t))
      .send({ hprId: '71-1234-5678-9012', medicalStream: 'ayurveda', specialization: 'Ayurveda', feePaise: 30000 }).expect(201);
    expect(r.body.hprId).toBe('71-1234-5678-9012');
    expect(r.body.isVerified).toBe(false);
    expect(r.body.price).toEqual({ feePaise: 30000, mdrPaise: 600, totalPaise: 30600 });
    await http().get('/auth/me').set(bearer(t)).expect((x) => expect(x.body.role).toBe('DOCTOR'));
  });
  it('cannot register twice', () =>
    http().post('/doctors/register').set(bearer(t)).send({ hprId: '71999999999999', medicalStream: 'mbbs', specialization: 'x', feePaise: 1 }).expect(403));
  it('duplicate HPR is a conflict', async () => {
    const t2 = await login(app, '9333333302');
    await http().post('/doctors/register').set(bearer(t2)).send({ hprId: HPR, medicalStream: 'mbbs', specialization: 'x', feePaise: 100 }).expect(409);
  });
  it('unverified doctors are hidden from search and by-id', async () => {
    const me = await http().get('/doctors/profile').set(bearer(t));
    await http().get(`/doctors/${me.body.id}`).set(bearer('test_token_123')).expect(404);
    const list = await http().get('/doctors?stream=ayurveda').set(bearer('test_token_123')).expect(200);
    expect(list.body.find((d: any) => d.id === me.body.id)).toBeUndefined();
  });
});

describe('Doctor profile, availability, search', () => {
  it('USER cannot use doctor endpoints', () => http().get('/doctors/profile').set(bearer('test_token_123')).expect(403));
  it('updates profile', async () => {
    await http().patch('/doctors/profile').set(doc).send({ specialization: 'Cardiology', feePaise: 50000 }).expect(200);
    await http().get('/doctors/profile').set(doc).expect((x) => {
      expect(x.body.specialization).toBe('Cardiology');
      expect(x.body.price.totalPaise).toBe(51000);
    });
  });
  it('rejects fee above max', () => http().patch('/doctors/profile').set(doc).send({ feePaise: 9_000_000 }).expect(400));
  it('sets availability, validates times', async () => {
    await http().put('/doctors/availability').set(doc).send({ days: [{ dayOfWeek: 1, startTime: '9:00', endTime: '12:00' }] }).expect(400);
    await http().put('/doctors/availability').set(doc).send({ days: [{ dayOfWeek: 1, startTime: '12:00', endTime: '09:00' }] }).expect(400);
    await http().put('/doctors/availability').set(doc).send({ days: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }, { dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] }).expect(400);
    const r = await http().put('/doctors/availability').set(doc)
      .send({ days: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }, { dayOfWeek: 3, startTime: '14:00', endTime: '16:00', slotMins: 30 }] }).expect(200);
    expect(r.body).toHaveLength(2);
    await http().get('/doctors/availability').set(doc).expect((x) => expect(x.body).toHaveLength(2));
  });
  it('replaces availability wholesale', async () => {
    await http().put('/doctors/availability').set(doc).send({ days: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] }).expect(200)
      .expect((x) => expect(x.body).toHaveLength(1));
  });
  it('search finds verified doctor by specialization / stream / bad stream 400', async () => {
    await http().get('/doctors?specialization=cardio').set(bearer('test_token_123')).expect(200).expect((x) => expect(x.body.length).toBeGreaterThanOrEqual(1));
    await http().get('/doctors?stream=dental').set(bearer('test_token_123')).expect(200).expect((x) => expect(x.body).toHaveLength(0));
    await http().get('/doctors?stream=bogus').set(bearer('test_token_123')).expect(400);
  });
  it('schedule requires a valid date', () => http().get('/doctors/schedule?date=nope').set(doc).expect(400));
});
