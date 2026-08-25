import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FeatureRankResponse, FeatureVectorDto } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { AuthService } from '../auth/auth.service.js';
import { CSRF_HEADER, SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from '../webhooks/drain.service.js';

interface Harness {
  app: INestApplication;
  rank: (kind: string, query?: string) => request.Test;
  get: (path: string) => request.Test;
}

/**
 * Boots an application, signs in, and puts the named scenarios through the real ingestion path.
 *
 * Each harness gets its own embedded database, which matters more than it looks: `asOf` is
 * resolved from the newest event in the whole store, so scenarios recorded over different
 * spans interfere with each other's windows. Isolating them is the difference between testing
 * a feature and testing an accident of the corpus.
 */
async function boot(families: readonly string[], email: string): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.init();

  await app.get(AuthService).createUser({
    email,
    password: 'correct-horse',
    displayName: 'F',
    role: 'analyst',
  });
  const signedIn = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'correct-horse' });
  const raw = signedIn.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw ?? ''];
  const cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
  const csrf = signedIn.body.csrfToken as string;

  // Features are computed from stored events, so the corpus has to travel the real path:
  // replay writes to the inbox, the drain redacts into canonical events, and only then is
  // there anything to compute. A test that inserted canonical rows directly would skip the
  // two stages most likely to be wrong.
  for (const family of families) {
    const written = await request(app.getHttpServer())
      .post('/api/replay')
      .set('Cookie', cookie)
      .set(CSRF_HEADER, csrf)
      .send({ family });
    expect(written.status, family).toBe(200);
  }

  // Drained to exhaustion, not once. A single pass claims INBOX_BATCH_SIZE events, which is
  // fewer than a scenario writes — and because the inbox drains in arrival order, the first
  // batch is entirely the first scenario. Stopping there would have left one session in the
  // database and a suite that quietly tested nothing.
  const drain = app.get(DrainService);
  for (let pass = 0; pass < 50; pass += 1) {
    if ((await drain.drainOnce()).claimed === 0) break;
  }

  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie);
  return { app, get, rank: (kind, query = '') => get(`/api/features/${kind}${query}`) };
}

const cardsOf = (v: FeatureVectorDto): number => v.distinctCards.exact ?? 0;

describe('features', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await boot(['attack_loud', 'retry_storm', 'gateway_outage'], 'features@test.local');
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
  });

  it('needs a session', async () => {
    // A feature vector describes how one shopper behaved. Pseudonymised or not, that is not
    // something to serve to whoever asks.
    expect((await request(h.app.getHttpServer()).get('/api/features/session')).status).toBe(401);
  });

  it('computes vectors from replayed traffic', async () => {
    const response = await h.rank('session');

    expect(response.status).toBe(200);
    const body = response.body as FeatureRankResponse;
    // Entities inside the window, which is a small number here and used to be a large one:
    // this asserted more than ten while counting every key across the whole read, most of them
    // hours outside the window being judged.
    expect(body.candidates).toBeGreaterThan(0);
    expect(body.vectors.length).toBeGreaterThan(0);
    expect(body.vectors.every((v) => v.entityKind === 'session')).toBe(true);
  });

  it('says when it is evaluating history rather than now', async () => {
    // The corpus carries the timestamps it was recorded with, months in the past. Computing
    // as of now would return a page of zeros; computing as of the last event without saying
    // so would present historical rates as live. It has to do the second thing and admit it.
    const body = (await h.rank('session')).body as FeatureRankResponse;

    expect(body.basis).toBe('last-activity');
    expect(body.newestObservationAt).not.toBeNull();
    expect(body.asOf).toBe(body.newestObservationAt);
    expect(body.generatedAt).toBeGreaterThan(body.asOf);
  });

  it('anchors the window to the newest event, so older scenarios fall outside it', async () => {
    // Worth pinning because it is surprising. Three scenarios were replayed; they start at the
    // same instant but run for five, forty-nine and a hundred and nineteen minutes. A
    // thirty-minute window ending at the newest event therefore contains only the longest of
    // them. That is correct — a rate is about a moment — but a reader looking for the
    // enumeration they just replayed deserves the page to say so rather than look empty.
    const body = (await h.rank('session', '?limit=100')).body as FeatureRankResponse;

    for (const vector of body.vectors) {
      expect(vector.asOf - vector.lastSeenAt!).toBeLessThanOrEqual(vector.window.windowMs);
    }
    // The five-minute enumeration burst is long over by the anchor moment.
    expect(body.vectors.some((v) => cardsOf(v) > 20)).toBe(false);
  });

  it('counts the entities it actually judged, not every key it has ever seen', async () => {
    // The read is bounded by row count rather than by time, so counting keys across all of it
    // claimed thousands had been considered while the window held a handful — beside a page
    // that says "entities seen" next to the few it shows.
    const body = (await h.rank('session', '?limit=1')).body as FeatureRankResponse;

    expect(body.candidates).toBeGreaterThan(0);
    expect(body.vectors).toHaveLength(1);

    const all = (await h.rank('session', '?limit=100')).body as FeatureRankResponse;
    expect(body.candidates).toBe(all.candidates);
    expect(all.candidates).toBeGreaterThanOrEqual(all.vectors.length);
  });

  it('confirms every sketch count it returns', async () => {
    // The contract the whole two-pass design exists to keep: nothing reaches a reader as an
    // estimate alone. `exact` being null here would mean a number nobody may decide on was
    // presented as if they could.
    const body = (await h.rank('session')).body as FeatureRankResponse;

    for (const vector of body.vectors) {
      expect(vector.distinctCards.exact, vector.entityKey).not.toBeNull();
      expect(vector.distinctSessions.exact).not.toBeNull();
      expect(vector.distinctNetworks.exact).not.toBeNull();
      expect(vector.distinctCards.errorBound).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the sketch within its stated error bound', async () => {
    const body = (await h.rank('session')).body as FeatureRankResponse;

    for (const vector of body.vectors) {
      const { estimate, exact } = vector.distinctCards;
      // At these cardinalities linear counting is exact, so the bound is generous on purpose:
      // the test is that the sketch is honest, not that it is lucky.
      expect(Math.abs(estimate - exact!), vector.entityKey).toBeLessThanOrEqual(
        Math.max(2, exact! * 0.1),
      );
    }
  });

  it('reports freshness per entity', async () => {
    const body = (await h.rank('session')).body as FeatureRankResponse;

    for (const vector of body.vectors) {
      expect(vector.lastSeenAt, vector.entityKey).not.toBeNull();
      expect(vector.lastSeenAt!).toBeLessThanOrEqual(vector.asOf);
    }
  });

  it('serves one entity on its own', async () => {
    const listed = (await h.rank('session')).body as FeatureRankResponse;
    const first = listed.vectors[0]!;

    const single = await h.get(`/api/features/session/${encodeURIComponent(first.entityKey)}`);

    expect(single.status).toBe(200);
    expect(single.body.vector.entityKey).toBe(first.entityKey);
    expect(single.body.vector.attempts).toBe(first.attempts);
    expect(single.body.vector.distinctCards.exact).toBe(first.distinctCards.exact);
  });

  it('answers for an entity it has never seen instead of failing', async () => {
    // An analyst pasting a key that has gone quiet should get an empty vector, not a 500.
    const zero = `v1:${'0'.repeat(64)}`;
    const response = await h.get(`/api/features/session/${zero}`);

    expect(response.status).toBe(200);
    expect(response.body.vector.attempts).toBe(0);
    expect(response.body.vector.lastSeenAt).toBeNull();
    expect(response.body.vector.distinctCards.exact).toBe(0);
  });

  it('bounds the limit rather than trusting it', async () => {
    expect(
      ((await h.rank('session', '?limit=1')).body as FeatureRankResponse).vectors,
    ).toHaveLength(1);
    expect((await h.rank('session', '?limit=99999')).status).toBe(200);
    expect((await h.rank('session', '?limit=-5')).status).toBe(200);
    expect((await h.rank('session', '?limit=nonsense')).status).toBe(200);
  });

  it('falls back to sessions for an entity kind it does not know', async () => {
    const body = (await h.rank('wizards')).body as FeatureRankResponse;
    expect(body.vectors.every((v) => v.entityKind === 'session')).toBe(true);
  });

  it('keeps replayed traffic separable from real traffic', async () => {
    // Everything here arrived through replay, so asking for real traffic must return nothing
    // rather than quietly handing back the synthetic events under a different label.
    const replayed = (await h.rank('session', '?source=replay')).body as FeatureRankResponse;
    const real = (await h.rank('session', '?source=razorpay')).body as FeatureRankResponse;

    expect(replayed.source).toBe('replay');
    expect(replayed.vectors.length).toBeGreaterThan(0);

    expect(real.source).toBe('razorpay');
    expect(real.candidates).toBe(0);
    expect(real.vectors).toHaveLength(0);
    expect(real.newestObservationAt).toBeNull();
  });

  it('ignores a source it does not recognise rather than guessing', async () => {
    const body = (await h.rank('session', '?source=inventions')).body as FeatureRankResponse;
    expect(body.source).toBe('all');
  });
});

describe('features, enumeration alone', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await boot(['attack_loud'], 'features-attack@test.local');
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
  });

  it('sees one session working through many cards', async () => {
    const body = (await h.rank('session', '?limit=100')).body as FeatureRankResponse;
    const worst = body.vectors[0]!;

    expect(worst.attempts).toBeGreaterThan(20);
    expect(cardsOf(worst)).toBeGreaterThan(20);
    expect(worst.approvalRate).toBeLessThan(0.2);
    // One machine: as many cards as attempts, from a single session and a single network.
    expect(worst.distinctSessions.exact).toBe(1);
    expect(worst.distinctNetworks.exact).toBe(1);
  });

  it('does not blame the infrastructure for cards being refused', async () => {
    // The failure this suite originally missed. Most of these declines carry `error_source:
    // bank` — the issuer refusing the card — and an earlier definition counted that as
    // infrastructure, which made an enumeration run look like an outage.
    const body = (await h.rank('session', '?limit=100')).body as FeatureRankResponse;
    const worst = body.vectors[0]!;

    expect(worst.failures).toBeGreaterThan(10);
    expect(worst.infrastructureFailureShare).toBe(0);
  });
});

describe('features, an outage alone', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await boot(['gateway_outage'], 'features-outage@test.local');
  }, 180_000);

  afterAll(async () => {
    await h.app.close();
  });

  it('attributes the trouble to the gateway, across unrelated shoppers', async () => {
    // The other end of the discriminator. An acquirer falling over produces gateway errors
    // spread over many sessions, each trying its own card once — the opposite shape to
    // enumeration, and the case where containing anyone would punish customers for an outage.
    const body = (await h.rank('network', '?limit=100')).body as FeatureRankResponse;
    const failing = body.vectors.filter((v) => v.failures > 0);

    expect(failing.length).toBeGreaterThan(0);
    expect(failing.every((v) => v.infrastructureFailureShare === 1)).toBe(true);

    // Spread, not concentration. Each shopper tries roughly one card and fails; the trouble is
    // shared across many of them rather than pooled in one. Enumeration is the mirror image:
    // one session, one network, dozens of cards.
    const shoppers = failing.reduce((most, v) => Math.max(most, v.distinctSessions.exact ?? 0), 0);
    expect(shoppers).toBeGreaterThan(1);
    expect(failing.every((v) => cardsOf(v) <= (v.distinctSessions.exact ?? 1) + 1)).toBe(true);
  });
});
