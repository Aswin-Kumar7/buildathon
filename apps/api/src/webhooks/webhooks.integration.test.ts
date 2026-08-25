import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { canonicalEvents, inboxEvents, type DbHandle } from '@sentinel/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ingestionMetricsSchema } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session.guard.js';
import { DrainService } from './drain.service.js';
import { IngestService } from './ingest.service.js';
import { sign } from './signature.js';
import { orderPaidBody, paymentCapturedBody, paymentFailedBody } from './fixtures.js';

const SECRET = 'whsec_test_only_do_not_use';

/**
 * A file-backed embedded Postgres, so "restart the process" can be tested honestly: an
 * in-memory database would forget everything on close, and the deduplication guarantee
 * would pass for the wrong reason.
 */
const dataDir = mkdtempSync(join(tmpdir(), 'sentinel-inbox-'));

async function boot(): Promise<INestApplication> {
  process.env.PGLITE_DIR = dataDir;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.init();
  return app;
}

describe('webhook ingestion', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let drain: DrainService;

  beforeAll(async () => {
    app = await boot();
    handle = app.get<DbHandle>(DB);
    drain = app.get(DrainService);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Posts a body exactly as Razorpay would, signing the same bytes that get sent. */
  function deliver(body: unknown, options: { eventId?: string; signature?: string } = {}) {
    const raw = JSON.stringify(body);
    const req = request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', options.signature ?? sign(raw, SECRET));

    if (options.eventId !== undefined) req.set('x-razorpay-event-id', options.eventId);
    return req.send(raw);
  }

  const countInbox = async () => (await handle.db.select().from(inboxEvents)).length;

  const rowFor = async (eventId: string) =>
    (await handle.db.select().from(inboxEvents).where(eq(inboxEvents.razorpayEventId, eventId)))[0];

  const canonicalFor = async (eventId: string) =>
    (
      await handle.db
        .select()
        .from(canonicalEvents)
        .where(eq(canonicalEvents.razorpayEventId, eventId))
    )[0];

  describe('signature', () => {
    it('rejects an unsigned delivery and persists nothing', async () => {
      const before = await countInbox();
      const raw = JSON.stringify(paymentFailedBody());

      const response = await request(app.getHttpServer())
        .post('/api/webhooks/razorpay')
        .set('content-type', 'application/json')
        .send(raw);

      expect(response.status).toBe(401);
      expect(await countInbox()).toBe(before);
    });

    it('rejects a wrong signature and persists nothing', async () => {
      const before = await countInbox();
      const response = await deliver(paymentFailedBody(), { signature: 'a'.repeat(64) });

      expect(response.status).toBe(401);
      expect(await countInbox()).toBe(before);
    });

    it('rejects a body altered after signing', async () => {
      // The classic attack: take a real signed event and change the amount.
      const before = await countInbox();
      const original = JSON.stringify(paymentFailedBody());
      const tampered = original.replace('49900', '1');

      const response = await request(app.getHttpServer())
        .post('/api/webhooks/razorpay')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', sign(original, SECRET))
        .send(tampered);

      expect(response.status).toBe(401);
      expect(await countInbox()).toBe(before);
    });

    it('accepts a correctly signed delivery', async () => {
      const response = await deliver(paymentFailedBody(), { eventId: 'evt_SIGOK001' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true, stored: true, late: false });
    });

    it('rejects an empty body rather than signing nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/webhooks/razorpay')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', sign('', SECRET))
        .send('');

      expect(response.status).toBe(400);
    });

    it('rejects a signed but unparseable body with 400, not a retryable 5xx', async () => {
      // Retrying will not make invalid JSON parse, so inviting 24 hours of redelivery
      // would just be noise.
      const raw = 'not json at all';
      const response = await request(app.getHttpServer())
        .post('/api/webhooks/razorpay')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', sign(raw, SECRET))
        .send(raw);

      expect(response.status).toBe(400);
    });
  });

  describe('deduplication', () => {
    it('stores a redelivered event once and counts the repeat', async () => {
      const body = paymentCapturedBody();
      const first = await deliver(body, { eventId: 'evt_DUP001' });
      const second = await deliver(body, { eventId: 'evt_DUP001' });
      const third = await deliver(body, { eventId: 'evt_DUP001' });

      expect(first.body.stored).toBe(true);
      expect(second.body.stored).toBe(false);
      expect(third.body.stored).toBe(false);

      const rows = await handle.db
        .select()
        .from(inboxEvents)
        .where(eq(inboxEvents.razorpayEventId, 'evt_DUP001'));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.deliveryCount).toBe(3);
    });

    it('answers 200 to a duplicate, because a repeat is not a failure', async () => {
      const body = paymentCapturedBody();
      await deliver(body, { eventId: 'evt_DUP002' });
      expect((await deliver(body, { eventId: 'evt_DUP002' })).status).toBe(200);
    });

    it('deduplicates on body content when Razorpay sends no event id', async () => {
      const body = paymentFailedBody({ created_at: 1_767_300_000 });
      const first = await deliver(body);
      const second = await deliver(body);

      expect(first.body.stored).toBe(true);
      expect(second.body.stored).toBe(false);
    });

    it('does not treat two different events as duplicates', async () => {
      const a = await deliver(paymentFailedBody({ created_at: 1_767_300_100 }));
      const b = await deliver(paymentFailedBody({ created_at: 1_767_300_200 }));

      expect(a.body.stored).toBe(true);
      expect(b.body.stored).toBe(true);
    });
  });

  describe('payload confidentiality', () => {
    it('stores no plaintext anywhere in the inbox row', async () => {
      await deliver(paymentFailedBody(), { eventId: 'evt_SECRET001' });
      const row = await rowFor('evt_SECRET001');
      const stored = JSON.stringify(row);

      expect(stored).not.toContain('shopper@example.com');
      expect(stored).not.toContain('+919876543210');
      expect(stored).not.toContain('1111');
      expect(stored).not.toContain('A Shopper');
      expect(row?.ciphertext).toBeTruthy();
    });

    it('keeps no customer field in the canonical event either', async () => {
      await deliver(paymentFailedBody(), { eventId: 'evt_SECRET002' });
      await drain.drainOnce();

      const stored = JSON.stringify(await canonicalFor('evt_SECRET002'));
      expect(stored).not.toContain('shopper@example.com');
      expect(stored).not.toContain('+919876543210');
      expect(stored).not.toContain('A Shopper');
    });

    it('never returns the payload in the acknowledgement', async () => {
      const response = await deliver(paymentFailedBody(), { eventId: 'evt_SECRET003' });
      expect(JSON.stringify(response.body)).not.toContain('shopper@example.com');
      expect(Object.keys(response.body).sort()).toEqual(['late', 'received', 'stored']);
    });
  });

  describe('durability', () => {
    it('returns a non-2xx when the durable write fails, so Razorpay retries', async () => {
      // The failure mode this guards is the worst one available: answering 200 and then
      // failing to persist means the event is gone for good, because Razorpay never sends
      // it again.
      const before = await countInbox();
      vi.spyOn(handle.db, 'insert').mockImplementationOnce(() => {
        throw new Error('could not write to disk');
      });

      const response = await deliver(paymentFailedBody({ created_at: 1_767_400_000 }));

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await countInbox()).toBe(before);
    });
  });

  describe('the drain', () => {
    it('derives a canonical event from a stored one', async () => {
      await deliver(paymentFailedBody(), { eventId: 'evt_DRAIN001' });
      const report = await drain.drainOnce();

      expect(report.processed).toBeGreaterThan(0);

      const canonical = await canonicalFor('evt_DRAIN001');
      expect(canonical?.eventType).toBe('payment.failed');
      expect(canonical?.razorpayOrderId).toBe('order_TESTORDER001');
      expect(canonical?.errorReason).toBe('payment_failed');
      expect(canonical?.cardIssuer).toBe('HDFC');
    });

    it('marks the row processed so a second pass does nothing', async () => {
      await deliver(paymentCapturedBody({ created_at: 1_767_500_000 }), {
        eventId: 'evt_DRAIN002',
      });
      await drain.drainOnce();

      const second = await drain.drainOnce();
      expect(second.claimed).toBe(0);
      expect((await rowFor('evt_DRAIN002'))?.status).toBe('processed');
    });

    it('produces exactly one canonical event when drained twice', async () => {
      await deliver(orderPaidBody({ created_at: 1_767_500_100 }), { eventId: 'evt_DRAIN003' });
      await drain.drainOnce();

      // Force a re-drain of an already-processed row: at-least-once means this happens
      // for real whenever the process dies between the write and the status update.
      await handle.db
        .update(inboxEvents)
        .set({ status: 'pending' })
        .where(eq(inboxEvents.razorpayEventId, 'evt_DRAIN003'));
      await drain.drainOnce();

      const rows = await handle.db
        .select()
        .from(canonicalEvents)
        .where(eq(canonicalEvents.razorpayEventId, 'evt_DRAIN003'));
      expect(rows).toHaveLength(1);
    });

    it('dead-letters a row after the configured number of attempts', async () => {
      await deliver(paymentFailedBody({ created_at: 1_767_600_000 }), { eventId: 'evt_DEAD001' });

      // Corrupt the ciphertext so decryption fails every time. This is what an unreadable
      // row looks like after a key rotation gone wrong.
      await handle.db
        .update(inboxEvents)
        .set({ ciphertext: 'bm90IHZhbGlkIGNpcGhlcnRleHQ=' })
        .where(eq(inboxEvents.razorpayEventId, 'evt_DEAD001'));

      await drain.drainOnce();
      expect((await rowFor('evt_DEAD001'))?.status).toBe('pending');
      expect((await rowFor('evt_DEAD001'))?.attempts).toBe(1);

      await drain.drainOnce();
      await drain.drainOnce();

      const row = await rowFor('evt_DEAD001');
      expect(row?.status).toBe('dead');
      expect(row?.attempts).toBe(3);
      expect(row?.lastError).toBeTruthy();
    });

    it('records why a row died without leaking the payload into the error', async () => {
      const row = await rowFor('evt_DEAD001');
      expect(row?.lastError).not.toContain('shopper@example.com');
      expect(row?.lastError).not.toContain('ciphertext');
    });

    it('can put a dead-lettered row back in the queue', async () => {
      const dead = await rowFor('evt_DEAD001');
      expect(await drain.retryDeadLettered(dead!.id)).toBe(true);

      const revived = await rowFor('evt_DEAD001');
      expect(revived?.status).toBe('pending');
      expect(revived?.attempts).toBe(0);

      // Put it back where the rest of the suite expects it.
      await handle.db
        .update(inboxEvents)
        .set({ status: 'dead', attempts: 3 })
        .where(eq(inboxEvents.razorpayEventId, 'evt_DEAD001'));
    });
  });

  describe('order independence', () => {
    it('resolves the same state whichever order the events arrive in', async () => {
      // Razorpay gives no ordering guarantee, so the natural order and its reverse must
      // both produce the same canonical set. This covers derivation only — the full
      // order-independent state machine over an attempt's history is Slice 5.
      const forward = [
        paymentFailedBody({ created_at: 1_767_700_000 }),
        paymentCapturedBody({ created_at: 1_767_700_060 }),
        orderPaidBody({ created_at: 1_767_700_120 }),
      ];

      for (const [index, body] of forward.entries()) {
        await deliver(body, { eventId: `evt_ORDER_A${index}` });
      }
      await drain.drainOnce();
      const a = await snapshot(['evt_ORDER_A0', 'evt_ORDER_A1', 'evt_ORDER_A2']);

      for (const [index, body] of [...forward].reverse().entries()) {
        await deliver(body, { eventId: `evt_ORDER_B${2 - index}` });
      }
      await drain.drainOnce();
      const b = await snapshot(['evt_ORDER_B0', 'evt_ORDER_B1', 'evt_ORDER_B2']);

      expect(b).toEqual(a);
    });

    async function snapshot(eventIds: string[]) {
      const rows = await Promise.all(eventIds.map((id) => canonicalFor(id)));
      return rows
        .map((row) => ({
          eventType: row?.eventType,
          entityType: row?.entityType,
          razorpayOrderId: row?.razorpayOrderId,
          razorpayPaymentId: row?.razorpayPaymentId,
          amountPaise: row?.amountPaise,
          status: row?.status,
          eventAt: row?.eventAt?.toISOString(),
        }))
        .sort((x, y) => String(x.eventType).localeCompare(String(y.eventType)));
    }
  });

  describe('lateness', () => {
    it('marks and counts an event that arrives beyond the allowed-lateness bound', async () => {
      // Far newer than anything so far, which pulls the watermark forward.
      await deliver(paymentCapturedBody({ created_at: 1_800_000_000 }), { eventId: 'evt_NEW001' });

      // Now something from long before the watermark. It is recorded and flagged, not
      // dropped: history is append-only and a late arrival corrects analytics rather than
      // rewriting a decision already taken.
      const response = await deliver(paymentFailedBody({ created_at: 1_700_000_000 }), {
        eventId: 'evt_LATE001',
      });

      expect(response.status).toBe(200);
      expect(response.body.late).toBe(true);
      expect((await rowFor('evt_LATE001'))?.late).toBe(true);
    });

    it('carries the late flag through to the canonical event', async () => {
      await drain.drainOnce();
      expect((await canonicalFor('evt_LATE001'))?.late).toBe(true);
    });

    it('does not mark an event that arrives within the bound', async () => {
      const response = await deliver(paymentCapturedBody({ created_at: 1_800_000_100 }), {
        eventId: 'evt_ONTIME001',
      });
      expect(response.body.late).toBe(false);
    });

    it('reports a watermark behind the newest event by the configured lateness', async () => {
      const ingest = app.get(IngestService);
      const mark = await ingest.watermark();

      const [newest] = await handle.db
        .select()
        .from(inboxEvents)
        .orderBy(desc(inboxEvents.eventAt))
        .limit(1);

      expect(mark!.getTime()).toBe(newest!.eventAt.getTime() - 5 * 60_000);
    });
  });

  describe('forensic retention', () => {
    it('drops ciphertext past the window but keeps the row for deduplication', async () => {
      await deliver(paymentFailedBody({ created_at: 1_767_800_000 }), { eventId: 'evt_PURGE001' });
      await drain.drainOnce();

      // Eight days on, one past the seven-day default.
      const purged = await drain.purgeExpiredPayloads(new Date(Date.now() + 8 * 86_400_000));
      expect(purged).toBeGreaterThan(0);

      const row = await rowFor('evt_PURGE001');
      expect(row?.ciphertext).toBeNull();
      expect(row?.purgedAt).not.toBeNull();
      expect(row?.razorpayEventId).toBe('evt_PURGE001');

      // The canonical event survives, which is the point: analysis keeps working after the
      // customer data is gone.
      expect((await canonicalFor('evt_PURGE001'))?.eventType).toBe('payment.failed');
    });

    it('leaves an unprocessed row alone, so nothing is purged before it is read', async () => {
      await deliver(paymentCapturedBody({ created_at: 1_767_900_000 }), {
        eventId: 'evt_PURGE002',
      });
      await drain.purgeExpiredPayloads(new Date(Date.now() + 30 * 86_400_000));

      expect((await rowFor('evt_PURGE002'))?.ciphertext).toBeTruthy();
    });
  });

  describe('timestamps', () => {
    it('never records a row as processed before it arrived', async () => {
      // A live event once reported a processing time of minus 195 milliseconds. received_at
      // and processed_at were each read from a container's own clock, minutes apart, and a
      // single NTP correction between them was enough to invert the pair. Both now come from
      // the database, which cannot disagree with itself.
      await deliver(paymentCapturedBody({ created_at: 1_768_200_000 }), {
        eventId: 'evt_CLOCK001',
      });
      await drain.drainOnce();

      const row = await rowFor('evt_CLOCK001');
      expect(row?.processedAt).not.toBeNull();
      expect(row!.processedAt!.getTime()).toBeGreaterThanOrEqual(row!.receivedAt.getTime());
    });

    it('stamps arrival from the database rather than from this process', async () => {
      // Written far enough apart that a process-supplied timestamp would be visibly earlier
      // than one the database assigned.
      const before = new Date();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await deliver(paymentCapturedBody({ created_at: 1_768_200_100 }), {
        eventId: 'evt_CLOCK002',
      });

      const row = await rowFor('evt_CLOCK002');
      expect(row?.receivedAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it('reports no negative processing time however the rows were written', async () => {
      const analyst = { email: 'clock@test.local', password: 'correct-horse', displayName: 'C' };
      await app.get(AuthService).createUser({ ...analyst, role: 'analyst' });

      const signedIn = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: analyst.email, password: analyst.password });

      const raw = signedIn.headers['set-cookie'];
      const list = Array.isArray(raw) ? raw : [raw ?? ''];
      const cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';

      const response = await request(app.getHttpServer())
        .get('/api/ingestion/metrics')
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      if (response.body.meanProcessingMs !== null) {
        expect(response.body.meanProcessingMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('metrics', () => {
    let cookie = '';

    beforeAll(async () => {
      const analyst = {
        email: 'metrics@test.local',
        password: 'correct-horse',
        displayName: 'M',
      };
      await app.get(AuthService).createUser({ ...analyst, role: 'analyst' });

      const signedIn = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: analyst.email, password: analyst.password });

      const raw = signedIn.headers['set-cookie'];
      const list = Array.isArray(raw) ? raw : [raw ?? ''];
      cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';
    }, 60_000);

    const read = () =>
      request(app.getHttpServer()).get('/api/ingestion/metrics').set('Cookie', cookie);

    it('needs a session, because it describes our internals', async () => {
      const response = await request(app.getHttpServer()).get('/api/ingestion/metrics');
      expect(response.status).toBe(401);
    });

    it('reports whether ingestion is configured at all', async () => {
      // Every other number is zero both when ingestion is healthy and idle and when the
      // webhook was never set up. Without this flag the page reports "all quiet" during an
      // outage.
      const response = await read();
      expect(response.status).toBe(200);
      expect(response.body.configured).toBe(true);
    });

    it('counts stored events and the duplicates that were not stored', async () => {
      const response = await read();
      expect(response.body.eventsStored).toBeGreaterThan(0);
      expect(response.body.duplicateDeliveries).toBeGreaterThan(0);
      expect(response.body.duplicateRate).toBeGreaterThan(0);
      expect(response.body.duplicateRate).toBeLessThan(1);
    });

    it('reports the dead-letter depth', async () => {
      expect((await read()).body.deadLetterDepth).toBeGreaterThan(0);
    });

    it('reports the late-event count', async () => {
      expect((await read()).body.lateEvents).toBeGreaterThan(0);
    });

    it('reports the watermark and the lateness bound that produced it', async () => {
      const response = await read();
      expect(response.body.watermark).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(response.body.allowedLatenessMinutes).toBe(5);
      expect(response.body.maxAttempts).toBe(3);
    });

    it('matches the ingestion metrics contract exactly', async () => {
      // The console parses this with the same schema, so a drift fails here rather than
      // as an empty panel in the browser.
      const body: unknown = (await read()).body;
      expect(() => ingestionMetricsSchema.parse(body)).not.toThrow();
    });

    it('reports the age of the oldest thing still waiting', async () => {
      await deliver(paymentCapturedBody({ created_at: 1_768_100_000 }), { eventId: 'evt_LAG001' });

      const response = await read();
      expect(response.body.pendingDepth).toBeGreaterThan(0);
      expect(response.body.oldestPendingAgeMs).toBeGreaterThanOrEqual(0);
    });
  });
});

/**
 * A second application over the same data directory — the same thing a redeploy or a crash
 * does. Deduplication has to survive it, because Razorpay's 24-hour retry window easily
 * outlives a process.
 */
describe('webhook ingestion across a restart', () => {
  const restartDir = mkdtempSync(join(tmpdir(), 'sentinel-restart-'));
  const body = paymentFailedBody({ created_at: 1_768_000_000 });

  async function bootAt(dir: string): Promise<INestApplication> {
    process.env.PGLITE_DIR = dir;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    return app;
  }

  function deliverTo(app: INestApplication, eventId: string) {
    const raw = JSON.stringify(body);
    return request(app.getHttpServer())
      .post('/api/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', sign(raw, SECRET))
      .set('x-razorpay-event-id', eventId)
      .send(raw);
  }

  afterAll(() => {
    rmSync(restartDir, { recursive: true, force: true });
  });

  it('stores a redelivery once even when the process died in between', async () => {
    const first = await bootAt(restartDir);
    const before = await deliverTo(first, 'evt_RESTART001');
    expect(before.body.stored).toBe(true);
    await first.close();

    const second = await bootAt(restartDir);
    const after = await deliverTo(second, 'evt_RESTART001');
    expect(after.status).toBe(200);
    expect(after.body.stored).toBe(false);

    const handle = second.get<DbHandle>(DB);
    const rows = await handle.db
      .select()
      .from(inboxEvents)
      .where(eq(inboxEvents.razorpayEventId, 'evt_RESTART001'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryCount).toBe(2);
    await second.close();
  }, 120_000);
});
