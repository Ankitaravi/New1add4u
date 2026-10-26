import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, makeApp } from './helpers';
import { formatHprId, validHprId } from '../src/common/hpr';
import { priceOf, rupees } from '../src/common/money';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Auth', () => {
  it('rejects bad phone', () => http().post('/auth/otp/send').send({ phone: '123' }).expect(400));
  it('sends otp', () => http().post('/auth/otp/send').send({ phone: '9111111111' }).expect(201));
  it('rejects wrong otp', () =>
    http().post('/auth/otp/verify').send({ phone: '9111111111', otp: '000000' }).expect(401));
  it('verify creates user + token, then /auth/me works, otp is single-use', async () => {
    const r = await http().post('/auth/otp/verify').send({ phone: '9111111111', otp: '123456' }).expect(201);
    expect(r.body.user.role).toBe('USER');
    await http().get('/auth/me').set(bearer(r.body.token)).expect(200).expect((x) => {
      expect(x.body.phone).toBe('9111111111');
    });
    await http().post('/auth/otp/verify').send({ phone: '9111111111', otp: '123456' }).expect(401);
  });
  it('401 without/with bad token', async () => {
    await http().get('/auth/me').expect(401);
    await http().get('/auth/me').set(bearer('nope')).expect(401);
  });
  it('seed tokens work and carry roles', async () => {
    await http().get('/auth/me').set(bearer('test_token_123')).expect(200).expect((x) => expect(x.body.role).toBe('USER'));
    await http().get('/auth/me').set(bearer('doc_token_123')).expect(200).expect((x) => expect(x.body.role).toBe('DOCTOR'));
    await http().get('/auth/me').set(bearer('lab_token_123')).expect(200).expect((x) => expect(x.body.role).toBe('INVESTIGATION'));
  });
  it('logout revokes token', async () => {
    const r = await http().post('/auth/otp/verify').send({ phone: '9111111111', otp: '123456' });
    // previous otp consumed; request a new one
    await http().post('/auth/otp/send').send({ phone: '9222222222' });
    const v = await http().post('/auth/otp/verify').send({ phone: '9222222222', otp: '123456' }).expect(201);
    await http().post('/auth/logout').set(bearer(v.body.token)).expect(201);
    await http().get('/auth/me').set(bearer(v.body.token)).expect(401);
  });
});

describe('Users', () => {
  const t = bearer('test_token_123');
  it('gets and updates profile', async () => {
    await http().patch('/users/profile').set(t).send({ name: 'Ravi', gender: 'male' }).expect(200);
    await http().get('/users/profile').set(t).expect(200).expect((x) => expect(x.body.name).toBe('Ravi'));
  });
  it('validates profile', () => http().patch('/users/profile').set(t).send({ gender: 'x' }).expect(400));
  it('family CRUD is scoped to owner', async () => {
    const a = await http().post('/users/family').set(t).send({ name: 'Mom', relation: 'mother' }).expect(201);
    await http().get('/users/family').set(t).expect(200).expect((x) => expect(x.body).toHaveLength(1));
    await http().delete(`/users/family/${a.body.id}`).set(bearer('doc_token_123')).expect(404);
    await http().delete(`/users/family/${a.body.id}`).set(t).expect(200);
  });
});

describe('Business rules', () => {
  it('MDR is 2%', () => expect(priceOf(50000)).toEqual({ feePaise: 50000, mdrPaise: 1000, totalPaise: 51000 }));
  it('rupees formatting', () => {
    expect(rupees(2350)).toBe('₹23.50');
    expect(rupees(251000)).toBe('₹2510');
  });
  it('HPR id', () => {
    expect(validHprId('71123456789012')).toBe(true);
    expect(validHprId('1234')).toBe(false);
    expect(formatHprId('71123456789012')).toBe('71-1234-5678-9012');
  });
});
