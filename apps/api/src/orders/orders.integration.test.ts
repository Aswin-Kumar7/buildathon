import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { checkoutSessions, type DbHandle } from '@sentinel/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { DB } from '../db/db.module.js';
import { RazorpayClient, type RazorpayOrder } from './razorpay.client.js';

/**
 * Razorpay is replaced by a stub. The point of this suite is our side of the contract —
 * what we price, what we persist, and what we refuse — and a suite that called the real
 * API would fail offline, rate-limit in CI, and leave test orders behind. The live call
 * is verified separately against test mode.
 */
class StubRazorpay {
  readonly calls: { amountPaise: number; receipt: string }[] = [];
  readonly keyId = 'rzp_test_stub';
  readonly isConfigured = true;

  createOrder(input: { amountPaise: number; receipt: string }): Promise<RazorpayOrder> {
    this.calls.push(input);
    return Promise.resolve({
      id: `order_stub${this.calls.length}`,
      amount: input.amountPaise,
      currency: 'INR',
      status: 'created',
      receipt: input.receipt,
    });
  }
}

describe('orders', () => {
  let app: INestApplication;
  let handle: DbHandle;
  let razorpay: StubRazorpay;

  const session = 'sess-0000-1111-2222';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RazorpayClient)
      .useClass(StubRazorpay)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    handle = app.get<DbHandle>(DB);
    razorpay = app.get<StubRazorpay>(RazorpayClient);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/orders')
      .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0')
      .send(body as object);

  const rowFor = async (orderId: string) =>
    (
      await handle.db
        .select()
        .from(checkoutSessions)
        .where(eq(checkoutSessions.razorpayOrderId, orderId))
    )[0];

  it('serves the catalogue', async () => {
    const response = await request(app.getHttpServer()).get('/api/catalog');
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(4);
    expect(response.body.items[0]).toHaveProperty('pricePaise');
  });

  it('creates an order and returns the publishable key only', async () => {
    const response = await post({
      lines: [{ sku: 'mug-01', quantity: 1 }],
      clientSessionId: session,
    });

    expect(response.status).toBe(201);
    expect(response.body.razorpayOrderId).toMatch(/^order_/);
    expect(response.body.amountPaise).toBe(49_900);
    expect(response.body.razorpayKeyId).toBe('rzp_test_stub');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('prices the cart on the server, ignoring any amount the client sends', async () => {
    const response = await post({
      lines: [{ sku: 'grinder-01', quantity: 2 }],
      clientSessionId: session,
      amountPaise: 100,
      amount: 100,
    });

    expect(response.status).toBe(201);
    expect(response.body.amountPaise).toBe(699_800);
    expect(razorpay.calls.at(-1)?.amountPaise).toBe(699_800);
  });

  it('sends a unique receipt per order, which is how a retry stays one order', async () => {
    await post({ lines: [{ sku: 'mug-01', quantity: 1 }], clientSessionId: session });
    await post({ lines: [{ sku: 'mug-01', quantity: 1 }], clientSessionId: session });

    const receipts = razorpay.calls.map((call) => call.receipt);
    expect(new Set(receipts).size).toBe(receipts.length);
  });

  it('rejects an unknown sku rather than silently dropping it', async () => {
    const before = razorpay.calls.length;
    const response = await post({
      lines: [
        { sku: 'mug-01', quantity: 1 },
        { sku: 'ghost-99', quantity: 1 },
      ],
      clientSessionId: session,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('ghost-99');
    expect(razorpay.calls).toHaveLength(before);
  });

  it('rejects an empty cart', async () => {
    const response = await post({ lines: [], clientSessionId: session });
    expect(response.status).toBe(400);
  });

  it('rejects a missing client session id', async () => {
    const response = await post({ lines: [{ sku: 'mug-01', quantity: 1 }] });
    expect(response.status).toBe(400);
  });

  it('records the request context keyed on the razorpay order id', async () => {
    const response = await post({
      lines: [{ sku: 'kettle-01', quantity: 3 }],
      clientSessionId: session,
    });
    const row = await rowFor(response.body.razorpayOrderId);

    expect(row).toBeDefined();
    expect(row?.amountPaise).toBe(449_700);
    expect(row?.itemCount).toBe(3);
    expect(row?.userAgentFamily).toBe('chrome');
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('stores no raw identifier — every one is a versioned keyed hash', async () => {
    const email = 'shopper@example.com';
    const response = await post({
      lines: [{ sku: 'mug-01', quantity: 1 }],
      clientSessionId: session,
      email,
    });
    const row = await rowFor(response.body.razorpayOrderId);
    const stored = JSON.stringify(row);

    expect(stored).not.toContain(email);
    expect(stored).not.toContain(session);
    expect(stored).not.toContain('Mozilla');
    expect(stored).not.toContain('127.0.0.1');
    for (const value of [row?.ipPseudonym, row?.emailPseudonym, row?.sessionPseudonym]) {
      expect(value).toMatch(/^v1:[0-9a-f]{64}$/);
    }
  });

  it('gives the same shopper the same session pseudonym across orders', async () => {
    const a = await post({
      lines: [{ sku: 'mug-01', quantity: 1 }],
      clientSessionId: 'stable-session-id',
    });
    const b = await post({
      lines: [{ sku: 'filter-02', quantity: 1 }],
      clientSessionId: 'stable-session-id',
    });

    const rowA = await rowFor(a.body.razorpayOrderId);
    const rowB = await rowFor(b.body.razorpayOrderId);

    // Correlating repeat attempts is the whole purpose of the sensor. If this drifts,
    // a burst of cards tried from one browser stops looking like one burst.
    expect(rowA?.sessionPseudonym).toBe(rowB?.sessionPseudonym);
  });

  it('gives different shoppers different pseudonyms', async () => {
    const a = await post({
      lines: [{ sku: 'mug-01', quantity: 1 }],
      clientSessionId: 'shopper-one-id',
    });
    const b = await post({
      lines: [{ sku: 'mug-01', quantity: 1 }],
      clientSessionId: 'shopper-two-id',
    });

    const rowA = await rowFor(a.body.razorpayOrderId);
    const rowB = await rowFor(b.body.razorpayOrderId);

    expect(rowA?.sessionPseudonym).not.toBe(rowB?.sessionPseudonym);
  });

  it('leaves the email pseudonym null when no email is given', async () => {
    const response = await post({
      lines: [{ sku: 'mug-01', quantity: 1 }],
      clientSessionId: session,
    });
    const row = await rowFor(response.body.razorpayOrderId);
    expect(row?.emailPseudonym).toBeNull();
  });
});
