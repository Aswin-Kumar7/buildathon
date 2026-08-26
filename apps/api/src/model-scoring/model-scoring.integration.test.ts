import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncidentDetailResponse, IncidentListResponse } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';
import { ModelScoringService } from './model-scoring.service.js';

describe('model scoring', () => {
  let app: INestApplication;
  let cookie = '';
  let csrf = '';

  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const post = (path: string, body?: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf)
      .send(body ?? {});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    await app.get(AuthService).createUser({
      email: 'model@test.local',
      password: 'correct-horse',
      displayName: 'M',
      role: 'analyst',
    });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'model@test.local', password: 'correct-horse' });
    const raw = signedIn.headers['set-cookie'];
    cookie =
      (Array.isArray(raw) ? raw : [raw ?? '']).find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
    csrf = signedIn.body.csrfToken;

    await post('/api/replay', { family: 'attack_loud' });
    const drain = app.get(DrainService);
    for (let pass = 0; pass < 50; pass += 1) if ((await drain.drainOnce()).claimed === 0) break;
    await post('/api/incidents/evaluate');
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it('loads the served model in this environment', () => {
    // The artefact is committed, so scoring is available here. Its absence is a first-class path
    // (degraded:model), covered by the graceful read and asserted on the frontend.
    expect(app.get(ModelScoringService).available).toBe(true);
  });

  it('attaches the model risk opinion to an incident', async () => {
    const list = (await get('/api/incidents')).body as IncidentListResponse;
    const detail = (await get(`/api/incidents/${list.incidents[0]!.id}`))
      .body as IncidentDetailResponse;

    expect(detail.incident.modelAvailable).toBe(true);
    expect(detail.incident.modelOpinion).not.toBeNull();
    const opinion = detail.incident.modelOpinion!;
    // A loud enumeration is what the model scores as high card-testing risk.
    expect(opinion.risk).toBeGreaterThan(0.5);
    expect(opinion.predictedClass).toBe('abuse');
    // The two-class distribution sums to one, and the contributions are the per-feature reasons.
    const total = opinion.probabilities.reduce((sum, p) => sum + p.probability, 0);
    expect(total).toBeCloseTo(1, 1);
    expect(opinion.contributions.length).toBeGreaterThan(0);
  });

  it('serves the model registry, tying a decision to the model that informed it', async () => {
    const body = (await get('/api/model/registry')).body;
    expect(body.available).toBe(true);
    expect(body.registry.version).toBe('r1');
    expect(body.registry.featureDefinitionVersion).toMatch(/^fdv-/);
    expect(body.registry.trainingDataHash).toMatch(/^sha256:/);
  });

  it('serves the deployed model metrics: the honest evaluation and per-origin breakdown', async () => {
    const body = (await get('/api/model/metrics')).body;
    expect(body.available).toBe(true);
    // The number shown is the deployed model's, on synthetic labels, and the page says so.
    expect(body.model.provenance.dataSource).toBe('synthetic-cardtesting');
    expect(body.model.honest.prAuc.point).toBeGreaterThan(0);
    expect(body.model.honest.perOrigin.length).toBeGreaterThan(5);
    expect(body.model.ablation.length).toBeGreaterThan(1);
    expect(body.model.leakage.honestGroupOverlap).toBe(0);
  });
});
