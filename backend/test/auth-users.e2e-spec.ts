import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, loginFull, makeApp } from './helpers';
import { formatHprId, validHprId } from '../src/common/hpr';
import { priceOf, rupees } from '../src/common/money';

let app: INestApplication;
const http = () => request(app.getHttpServer());
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Auth', () => {
  const request_ = (phone: string) => http().post('/auth/otp/request').send({ phone });
  const verify = (phone: string, challengeId: string, code = '123456') =>
    http().post('/auth/otp/verify').send({ phone, challengeId, code });

  it('validates phone and verify body', async () => {
    await request_('123').expect(400);
    await http().post('/auth/otp/verify').send({ phone: '9111111111', code: '123456' }).expect(400); // no challengeId
  });
  it('request returns a challenge', async () => {
    const r = await request_('9111111110').expect(201);
    expect(r.body.challengeId).toEqual(expect.any(String));
    expect(r.body.expiresInSeconds).toBe(300);
  });
  it('verify: wrong code, wrong phone, unknown challenge are all 401', async () => {
    const { body } = await request_('9111111111');
    await verify('9111111111', body.challengeId, '000000').expect(401);
    await verify('9222222221', body.challengeId).expect(401); // challenge belongs to another number
    await verify('9111111111', 'nope').expect(401);
  });
  it('verify issues tokens + user; /auth/me works; the code is single-use', async () => {
    const { body: c } = await request_('9111111112');
    const r = await verify('9111111112', c.challengeId).expect(201);
    expect(r.body).toMatchObject({ expiresInSeconds: 900, adminApprovalRequired: false });
    expect(r.body.user.role).toBe('USER');
    expect(r.body.accessToken).not.toBe(r.body.refreshToken);
    await http().get('/auth/me').set(bearer(r.body.accessToken)).expect(200).expect((x) => expect(x.body.phone).toBe('9111111112'));
    await verify('9111111112', c.challengeId).expect(401);
  });
  it('locks a challenge after 5 wrong guesses, even if the right code follows', async () => {
    const { body: c } = await request_('9111111113');
    for (let i = 0; i < 5; i++) await verify('9111111113', c.challengeId, '00000' + i).expect(401);
    await verify('9111111113', c.challengeId).expect(401);
  });
  it('an expired challenge is rejected', async () => {
    const { body: c } = await request_('9111111114');
    await app.get(PrismaService).otp.update({ where: { id: c.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await verify('9111111114', c.challengeId).expect(401);
  });
  it('rate limits OTP requests per phone (5/hour)', async () => {
    for (let i = 0; i < 5; i++) await request_('9111111115').expect(201);
    await request_('9111111115').expect(429);
    await request_('9111111116').expect(201); // other numbers unaffected
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
  it('access tokens expire', async () => {
    const t = await loginFull(app, '9111111117');
    await app.get(PrismaService).authToken.update({ where: { token: t.accessToken }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().get('/auth/me').set(bearer(t.accessToken)).expect(401);
    // ...and the refresh token still gets a working one
    const r = await http().post('/auth/refresh').send({ refreshToken: t.refreshToken }).expect(200);
    await http().get('/auth/me').set(bearer(r.body.accessToken)).expect(200);
  });
});

describe('Refresh tokens', () => {
  const refresh = (refreshToken: string) => http().post('/auth/refresh').send({ refreshToken });

  it('rotates: new pair works, response shape matches the app', async () => {
    const t = await loginFull(app, '9333333301');
    const r = await refresh(t.refreshToken).expect(200);
    expect(r.body.accessToken).toEqual(expect.any(String));
    expect(r.body.refreshToken).not.toBe(t.refreshToken);
    await http().get('/auth/me').set(bearer(r.body.accessToken)).expect(200);
    const r2 = await refresh(r.body.refreshToken).expect(200); // chain keeps working
    await http().get('/auth/me').set(bearer(r2.body.accessToken)).expect(200);
  });
  it('reusing a rotated refresh token is treated as theft: the whole session dies', async () => {
    const t = await loginFull(app, '9333333302');
    const r = await refresh(t.refreshToken).expect(200);
    await refresh(t.refreshToken).expect(401); // attacker (or a buggy client) replays the old token
    await refresh(r.body.refreshToken).expect(401); // the legitimate newest token is now dead too
    await http().get('/auth/me').set(bearer(r.body.accessToken)).expect(401);
    await http().get('/auth/me').set(bearer(t.accessToken)).expect(401);
  });
  it('simultaneous refreshes with one token: at most one wins, and the session is revoked', async () => {
    const t = await loginFull(app, '9333333303');
    const rs = await Promise.all([refresh(t.refreshToken), refresh(t.refreshToken)]);
    expect(rs.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(rs.some((r) => r.status === 401)).toBe(true);
  });
  it('rejects garbage and expired refresh tokens', async () => {
    await refresh('nope').expect(401);
    await http().post('/auth/refresh').send({}).expect(400);
    const t = await loginFull(app, '9333333304');
    await app.get(PrismaService).refreshToken.updateMany({ where: { userId: t.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await refresh(t.refreshToken).expect(401);
  });
  it('logout ends the session on the server, without needing a valid access token; idempotent', async () => {
    const t = await loginFull(app, '9333333305');
    await http().post('/auth/logout').send({ refreshToken: t.refreshToken }).expect(200);
    await http().get('/auth/me').set(bearer(t.accessToken)).expect(401);
    await refresh(t.refreshToken).expect(401);
    await http().post('/auth/logout').send({ refreshToken: t.refreshToken }).expect(200);
    await http().post('/auth/logout').send({ refreshToken: 'unknown' }).expect(200);
  });
  it('logging out one device leaves the user\'s other session alone', async () => {
    const a = await loginFull(app, '9333333306');
    const b = await loginFull(app, '9333333306');
    await http().post('/auth/logout').send({ refreshToken: a.refreshToken }).expect(200);
    await http().get('/auth/me').set(bearer(b.accessToken)).expect(200);
    await refresh(b.refreshToken).expect(200);
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
