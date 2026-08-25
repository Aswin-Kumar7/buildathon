import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { canonicalEvents, checkoutSessions, inboxEvents, type DbHandle } from '@sentinel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ordersResponseSchema } from '@sentinel/contracts';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { AuthService } from '../auth/auth.service.js';
import { SESSION_COOKIE } from '../auth/session.guard.js';

/**
 * Events are written straight into the canonical table rather than delivered through the
 * webhook endpoint. This suite is about resolution, not ingestion — that has its own tests —
 * and going through the whole pipeline to set up a fixture would make a failure here
 * ambiguous between the two.
 */
describe('attempts', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let cookie = '';

  const at = (iso: string) => new Date(iso);

  async function writeEvent(input: {
    id: string;
    type: string;
    orderId: string;
    paymentId: string | null;
    eventAt: string;
    status?: string;
    errorReason?: string;
    late?: boolean;
  }): Promise<void> {
    const [inbox] = await handle.db
      .insert(inboxEvents)
      .values({
        razorpayEventId: input.id,
        eventType: input.type,
        eventAt: at(input.eventAt),
        status: 'processed',
        late: input.late ?? false,
      })
      .returning();

    await handle.db.insert(canonicalEvents).values({
      inboxEventId: inbox!.id,
      razorpayEventId: input.id,
      eventType: input.type,
      entityType: 'payment',
      razorpayOrderId: input.orderId,
      razorpayPaymentId: input.paymentId,
      amountPaise: 149_900,
      currency: 'INR',
      status: input.status ?? null,
      method: 'card',
      errorReason: input.errorReason ?? null,
      eventAt: at(input.eventAt),
      receivedAt: at(input.eventAt),
      late: input.late ?? false,
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    handle = app.get<DbHandle>(DB);

    const analyst = { email: 'attempts@test.local', password: 'correct-horse', displayName: 'A' };
    await app.get(AuthService).createUser({ ...analyst, role: 'analyst' });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: analyst.email, password: analyst.password });
    const raw = signedIn.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw ?? ''];
    cookie = list.find((c) => c.startsWith(SESSION_COOKIE)) ?? '';

    // The real sequence from the deployed instance: a card declined as international, then a
    // successful retry under a second payment on the same order.
    await writeEvent({
      id: 'e1',
      type: 'payment.failed',
      orderId: 'order_REC',
      paymentId: 'pay_1',
      eventAt: '2026-08-25T11:16:09Z',
      status: 'failed',
      errorReason: 'international_transaction_not_allowed',
    });
    await writeEvent({
      id: 'e2',
      type: 'payment.authorized',
      orderId: 'order_REC',
      paymentId: 'pay_2',
      eventAt: '2026-08-25T11:18:56Z',
      status: 'authorized',
    });
    await writeEvent({
      id: 'e3',
      type: 'payment.captured',
      orderId: 'order_REC',
      paymentId: 'pay_2',
      eventAt: '2026-08-25T11:18:57Z',
      status: 'captured',
    });
    await writeEvent({
      id: 'e4',
      type: 'order.paid',
      orderId: 'order_REC',
      paymentId: 'pay_2',
      eventAt: '2026-08-25T11:18:57Z',
      status: 'captured',
    });

    // An order where every attempt failed.
    await writeEvent({
      id: 'e5',
      type: 'payment.failed',
      orderId: 'order_BAD',
      paymentId: 'pay_3',
      eventAt: '2026-08-25T12:00:00Z',
      status: 'failed',
      errorReason: 'payment_failed',
    });
    await writeEvent({
      id: 'e6',
      type: 'payment.failed',
      orderId: 'order_BAD',
      paymentId: 'pay_4',
      eventAt: '2026-08-25T12:00:20Z',
      status: 'failed',
      errorReason: 'payment_failed',
    });

    // A checkout with sensor context, so the join has something to find.
    await handle.db.insert(checkoutSessions).values({
      razorpayOrderId: 'order_REC',
      ipPseudonym: 'v1:aaaaaaaa1111111111111111111111111111111111111111111111111111aaaa',
      devicePseudonym: 'v1:bbbbbbbb2222222222222222222222222222222222222222222222222222bbbb',
      sessionPseudonym: 'v1:cccccccc3333333333333333333333333333333333333333333333333333cccc',
      userAgentFamily: 'chrome',
      amountPaise: 149_900,
      itemCount: 1,
    });

    // A checkout that never produced an event, created far enough in the past to be past the
    // allowed-lateness bound.
    await handle.db.insert(checkoutSessions).values({
      razorpayOrderId: 'order_ABANDONED',
      ipPseudonym: 'v1:dddddddd4444444444444444444444444444444444444444444444444444dddd',
      devicePseudonym: 'v1:eeeeeeee5555555555555555555555555555555555555555555555555555eeee',
      sessionPseudonym: 'v1:ffffffff6666666666666666666666666666666666666666666666666666ffff',
      userAgentFamily: 'safari',
      amountPaise: 49_900,
      itemCount: 2,
      createdAt: new Date(Date.now() - 60 * 60_000),
    });
  }, 90_000);

  afterAll(async () => {
    await app.close();
  });

  const list = () => request(app.getHttpServer()).get('/api/attempts').set('Cookie', cookie);

  it('needs a session', async () => {
    expect((await request(app.getHttpServer()).get('/api/attempts')).status).toBe(401);
  });

  it('matches the contract the console parses with', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(() => ordersResponseSchema.parse(response.body)).not.toThrow();
  });

  it('resolves a decline followed by a retry into one recovered order', async () => {
    const response = await list();
    const order = response.body.orders.find(
      (o: { razorpayOrderId: string }) => o.razorpayOrderId === 'order_REC',
    );

    expect(order.outcome).toBe('paid');
    expect(order.recovered).toBe(true);
    expect(order.failureCount).toBe(1);
    expect(order.attempts).toHaveLength(2);
  });

  it('keeps the failure visible on the recovered order', async () => {
    const response = await list();
    const order = response.body.orders.find(
      (o: { razorpayOrderId: string }) => o.razorpayOrderId === 'order_REC',
    );

    expect(order.attempts[0].status).toBe('failed');
    expect(order.attempts[0].failure.reason).toBe('international_transaction_not_allowed');
    expect(order.attempts[1].status).toBe('captured');
  });

  it('does not call an order where everything failed a recovery', async () => {
    const response = await list();
    const order = response.body.orders.find(
      (o: { razorpayOrderId: string }) => o.razorpayOrderId === 'order_BAD',
    );

    expect(order.outcome).toBe('failed');
    expect(order.recovered).toBe(false);
    expect(order.failureCount).toBe(2);
  });

  it('joins the checkout context Razorpay never sends', async () => {
    const response = await list();
    const order = response.body.orders.find(
      (o: { razorpayOrderId: string }) => o.razorpayOrderId === 'order_REC',
    );

    expect(order.sensor.userAgentFamily).toBe('chrome');
    expect(order.sensor.sessionFingerprint).toBe('cccccccc');
    expect(order.sensor.itemCount).toBe(1);
  });

  it('shortens the pseudonym rather than publishing it', async () => {
    const response = await list();
    const order = response.body.orders.find(
      (o: { razorpayOrderId: string }) => o.razorpayOrderId === 'order_REC',
    );

    expect(order.sensor.sessionFingerprint).toHaveLength(8);
    expect(JSON.stringify(order.sensor)).not.toContain('cccccccc3333');
    expect(JSON.stringify(order.sensor)).not.toContain('v1:');
  });

  it('reports an abandoned checkout as unresolved rather than as a failure', async () => {
    // Assuming it failed would invent a failure that never happened, in the one system where
    // failure counts are the signal.
    const response = await list();
    const abandoned = response.body.unresolved.find(
      (u: { razorpayOrderId: string }) => u.razorpayOrderId === 'order_ABANDONED',
    );

    expect(abandoned).toBeDefined();
    expect(abandoned.ageMinutes).toBeGreaterThanOrEqual(59);
    expect(
      response.body.orders.map((o: { razorpayOrderId: string }) => o.razorpayOrderId),
    ).not.toContain('order_ABANDONED');
  });

  it('does not report a checkout that did produce events as unresolved', async () => {
    const response = await list();
    expect(
      response.body.unresolved.map((u: { razorpayOrderId: string }) => u.razorpayOrderId),
    ).not.toContain('order_REC');
  });

  it('serves one order on its own', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/attempts/order_REC')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.order.razorpayOrderId).toBe('order_REC');
    expect(response.body.order.recovered).toBe(true);
  });

  it('404s an order it has never seen', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/attempts/order_NOTHING')
      .set('Cookie', cookie);

    expect(response.status).toBe(404);
  });
});
