import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bearer, login, makeApp, pushLog } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');
const admin = bearer('admin_token_123');
const hadmin = bearer('hadmin_token_123');
const stu = bearer('student_token_123');
const stu2 = bearer('student2_token');

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); });

describe('Admin', () => {
  it('is super-admin only', async () => {
    await http().get('/admin/users').set(u1).expect(403);
    await http().get('/admin/users').set(hadmin).expect(403);
    await http().get('/admin/stats').set(bearer('doc_token_123')).expect(403);
    await http().get('/admin/users').expect(401);
  });
  it('lists / filters / pages users', async () => {
    const all = await http().get('/admin/users?limit=3').set(admin).expect(200);
    expect(all.body.items).toHaveLength(3);
    expect(all.body.total).toBeGreaterThanOrEqual(10);
    await http().get('/admin/users?role=PHARMA').set(admin).expect((x) => expect(x.body.items.every((u: any) => u.role === 'PHARMA')).toBe(true));
    await http().get('/admin/users?q=9000000001').set(admin).expect((x) => expect(x.body.items.map((u: any) => u.phone)).toEqual(['9000000001']));
    await http().get('/admin/users?role=NOPE').set(admin).expect(200); // unknown role is ignored, not a crash
  });
  it('doctor verification: pending list, verify, revoke, notify', async () => {
    const t = await login(app, '9777777701');
    const reg = await http().post('/doctors/register').set(bearer(t)).send({ hprId: '71000000000701', medicalStream: 'dental', specialization: 'Dentist', feePaise: 20000 }).expect(201);
    await http().get('/admin/doctors/pending').set(admin).expect((x) => {
      const d = x.body.find((p: any) => p.id === reg.body.id);
      expect(d.hprId).toBe('71-0000-0000-0701');
    });
    await http().patch(`/admin/doctors/${reg.body.id}/verify`).set(admin).send({ verified: 'yes' }).expect(400);
    await http().patch('/admin/doctors/nope/verify').set(admin).send({ verified: true }).expect(404);
    await http().patch(`/admin/doctors/${reg.body.id}/verify`).set(bearer(t)).send({ verified: true }).expect(403); // cannot self-verify

    await http().get(`/doctors/${reg.body.id}`).set(u1).expect(404);
    await http().patch(`/admin/doctors/${reg.body.id}/verify`).set(admin).send({ verified: true }).expect(200);
    await http().get(`/doctors/${reg.body.id}`).set(u1).expect(200);
    await http().get('/notifications').set(bearer(t)).expect((x) => expect(x.body.items.map((n: any) => n.title)).toContain('Profile verified'));
    await http().get('/admin/doctors/pending').set(admin).expect((x) => expect(x.body.find((p: any) => p.id === reg.body.id)).toBeUndefined());

    await http().patch(`/admin/doctors/${reg.body.id}/verify`).set(admin).send({ verified: false }).expect(200);
    await http().get(`/doctors/${reg.body.id}`).set(u1).expect(404);
  });
  it('stats', async () => {
    const r = await http().get('/admin/stats').set(admin).expect(200);
    expect(Object.keys(r.body).sort()).toEqual(['appointments', 'doctors', 'revenuePaise', 'users', 'verifiedDoctors']);
    expect(r.body.users).toBeGreaterThan(0);
  });
});

describe('Students', () => {
  let courseId: string;
  it('role rules', async () => {
    await http().get('/students/courses').set(u1).expect(403);
    await http().post('/students/courses').set(stu).send({ title: 'Anatomy 101', lessons: 10 }).expect(403);
    await http().put('/students/profile').set(stu).send({ stream: 'law' }).expect(400);
  });
  it('profile + catalogue', async () => {
    await http().get('/students/profile').set(stu).expect(404);
    await http().put('/students/profile').set(stu).send({ college: 'AIIMS', stream: 'mbbs' }).expect(200);
    await http().put('/students/profile').set(stu2).send({ college: 'CMC' }).expect(200);
    await http().post('/students/courses').set(admin).send({ title: 'x', lessons: 10 }).expect(400);
    await http().post('/students/courses').set(admin).send({ title: 'Anatomy 101', lessons: 0 }).expect(400);
    courseId = (await http().post('/students/courses').set(admin).send({ title: 'Anatomy 101', stream: 'mbbs', lessons: 10 }).expect(201)).body.id;
    await http().post('/students/courses').set(admin).send({ title: 'Dental Basics', stream: 'dental', lessons: 5 }).expect(201);
    await http().get('/students/courses?stream=dental').set(stu).expect((x) => expect(x.body.map((c: any) => c.title)).toEqual(['Dental Basics']));
    await http().get('/students/courses?stream=bogus').set(stu).expect(400);
  });
  it('enroll once; progress only moves forward and is capped', async () => {
    await http().post('/students/courses/nope/enroll').set(stu).expect(404);
    await http().post(`/students/courses/${courseId}/enroll`).set(stu).expect(201);
    await http().post(`/students/courses/${courseId}/enroll`).set(stu).expect(409);
    await http().patch(`/students/courses/${courseId}/progress`).set(stu2).send({ progress: 1 }).expect(404);
    await http().patch(`/students/courses/${courseId}/progress`).set(stu).send({ progress: 11 }).expect(400);
    await http().patch(`/students/courses/${courseId}/progress`).set(stu).send({ progress: -1 }).expect(400);
    await http().patch(`/students/courses/${courseId}/progress`).set(stu).send({ progress: 6 }).expect(200).expect((x) => expect(x.body.progress).toBe(6));
    await http().patch(`/students/courses/${courseId}/progress`).set(stu).send({ progress: 2 }).expect(200).expect((x) => expect(x.body.progress).toBe(6));
    await http().get('/students/my-courses').set(stu).expect((x) => { expect(x.body).toHaveLength(1); expect(x.body[0].course.title).toBe('Anatomy 101'); });
    await http().get('/students/my-courses').set(stu2).expect((x) => expect(x.body).toHaveLength(0));
  });
});

describe('Referrals', () => {
  it('validates, dedupes, rejects self and existing users', async () => {
    const t = bearer(await login(app, '9888888801'));
    await http().post('/referrals').set(t).send({ phone: '123' }).expect(400);
    await http().post('/referrals').set(t).send({ phone: '9888888801' }).expect(400);
    await http().post('/referrals').set(t).send({ phone: '9000000001' }).expect(409); // already a user
    await http().post('/referrals').set(t).send({ phone: '9888888899' }).expect(201);
    await http().post('/referrals').set(t).send({ phone: '9888888899' }).expect(409);
    await http().get('/referrals/my').set(t).expect((x) => expect(x.body).toMatchObject([{ phone: '9888888899', joined: false }]));
    await login(app, '9888888899'); // the friend signs up
    await http().get('/referrals/my').set(t).expect((x) => expect(x.body[0].joined).toBe(true));
    await http().get('/referrals/my').set(u1).expect((x) => expect(x.body).toEqual([]));
  });
});
