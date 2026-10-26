import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ai, bearer, login, makeApp } from './helpers';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const u1 = bearer('test_token_123');

beforeAll(async () => { app = await makeApp(); });
afterAll(async () => { await app.close(); delete process.env.AI_HOURLY_LIMIT; });
beforeEach(() => { ai.calls = 0; ai.unconfigured = false; });

describe('Symptom check', () => {
  const ok = JSON.stringify({ urgency: 'see_doctor', possibleConditions: ['Viral fever', 'Flu', 'Dengue', 'Typhoid', 'Malaria'], suggestedSpecialization: 'General Medicine', advice: 'Rest and fluids.' });
  it('validates input', async () => {
    await http().post('/ai/symptom-check').set(u1).send({}).expect(400);
    await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'ab' }).expect(400);
    await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'fever', age: 500 }).expect(400);
    await http().post('/ai/symptom-check').send({ symptoms: 'fever and cough' }).expect(401);
  });
  it('returns structured result with disclaimer; caps conditions at 4', async () => {
    ai.reply = ok;
    const r = await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'fever and body ache for 3 days', age: 30 }).expect(201);
    expect(r.body).toMatchObject({ urgency: 'see_doctor', suggestedSpecialization: 'General Medicine', source: 'ai' });
    expect(r.body.possibleConditions).toHaveLength(4);
    expect(r.body.disclaimer).toMatch(/not a diagnosis/);
  });
  it('tolerates JSON wrapped in prose / code fences', async () => {
    ai.reply = 'Here you go:\n```json\n' + ok + '\n```';
    await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'fever and cough' }).expect(201);
  });
  it('red-flag symptoms short-circuit to emergency WITHOUT calling the model', async () => {
    ai.reply = ok;
    const r = await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'I have severe chest pain spreading to my arm' }).expect(201);
    expect(r.body).toMatchObject({ urgency: 'emergency', source: 'rules' });
    expect(r.body.advice).toMatch(/112/);
    expect(ai.calls).toBe(0);
  });
  it('502 on garbage or invalid urgency; 503 when AI is not configured', async () => {
    ai.reply = 'sorry I cannot help';
    await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'mild headache' }).expect(502);
    ai.reply = JSON.stringify({ urgency: 'whatever' });
    await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'mild headache' }).expect(502);
    ai.unconfigured = true;
    await http().post('/ai/symptom-check').set(u1).send({ symptoms: 'mild headache' }).expect(503);
  });
  it('rate limits per user', async () => {
    process.env.AI_HOURLY_LIMIT = '2';
    try {
      const t = bearer(await login(app, '9666666601'));
      const other = bearer(await login(app, '9666666602'));
      ai.reply = ok;
      await http().post('/ai/symptom-check').set(t).send({ symptoms: 'sore throat' }).expect(201);
      await http().post('/ai/symptom-check').set(t).send({ symptoms: 'sore throat' }).expect(201);
      await http().post('/ai/symptom-check').set(t).send({ symptoms: 'sore throat' }).expect(429);
      await http().post('/ai/symptom-check').set(other).send({ symptoms: 'sore throat' }).expect(201); // other user unaffected
    } finally {
      delete process.env.AI_HOURLY_LIMIT;
    }
  });
});

describe('Drug interaction', () => {
  it('needs 2-10 drugs', async () => {
    await http().post('/ai/drug-interaction').set(u1).send({ drugs: ['aspirin'] }).expect(400);
    await http().post('/ai/drug-interaction').set(u1).send({ drugs: Array(11).fill('x') }).expect(400);
    await http().post('/ai/drug-interaction').set(u1).send({ drugs: 'aspirin,warfarin' }).expect(400);
  });
  it('returns valid interactions only', async () => {
    ai.reply = JSON.stringify({
      interactions: [
        { drugs: ['warfarin', 'aspirin'], severity: 'major', description: 'Bleeding risk' },
        { drugs: ['a', 'b'], severity: 'catastrophic', description: 'bogus' },
        'garbage',
      ],
      summary: 'Avoid combining.',
    });
    const r = await http().post('/ai/drug-interaction').set(u1).send({ drugs: ['warfarin', 'aspirin'] }).expect(201);
    expect(r.body.interactions).toHaveLength(1);
    expect(r.body.interactions[0].severity).toBe('major');
    expect(r.body.disclaimer).toBeDefined();
  });
  it('empty interaction list is valid', async () => {
    ai.reply = JSON.stringify({ interactions: [], summary: 'None known.' });
    await http().post('/ai/drug-interaction').set(u1).send({ drugs: ['paracetamol', 'vitamin c'] }).expect(201).expect((x) => expect(x.body.interactions).toEqual([]));
  });
});
