import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { canonicalEvents, checkoutSessions, type DbHandle } from '@sentinel/db';
import type {
  OrdersResponse,
  ResolvedOrder,
  SensorContext,
  UnresolvedAttempt,
} from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { resolveOrder, type AttemptEvent, type ResolvedOrder as Resolved } from './state.js';

/**
 * Eight characters of a keyed hash. Enough for a person to see that two orders came from the
 * same session; not an identifier in its own right, and not reversible into one.
 */
function fingerprint(pseudonym: string): string {
  return pseudonym.replace(/^v\d+:/, '').slice(0, 8);
}

@Injectable()
export class AttemptsService {
  private readonly env = loadEnv();

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Attempts are resolved on read rather than maintained as a stored projection.
   *
   * The architecture calls for a materialised `payment_attempts` table, and at volume it will
   * need one. At this size the read is a single indexed query and the resolver is pure, so
   * computing it means there is exactly one definition of the truth — a stored projection is
   * a second one, and the two drift the first time an event arrives that the writer handled
   * and the reader did not.
   */
  async listOrders(limit = 50): Promise<OrdersResponse> {
    const recent = await this.handle.db
      .selectDistinct({ orderId: canonicalEvents.razorpayOrderId })
      .from(canonicalEvents)
      .where(sql`${canonicalEvents.razorpayOrderId} is not null`)
      .orderBy(desc(canonicalEvents.razorpayOrderId))
      .limit(limit);

    const orderIds = recent
      .map((row) => row.orderId)
      .filter((id): id is string => id !== null && id !== '');

    const orders = orderIds.length === 0 ? [] : await this.resolveMany(orderIds);

    return {
      orders: orders.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)),
      unresolved: await this.unresolved(),
      allowedLatenessMinutes: this.env.ALLOWED_LATENESS_MINUTES,
    };
  }

  async getOrder(razorpayOrderId: string): Promise<ResolvedOrder> {
    const [order] = await this.resolveMany([razorpayOrderId]);
    if (order === undefined) throw new NotFoundException(`No events for ${razorpayOrderId}`);
    return order;
  }

  private async resolveMany(orderIds: readonly string[]): Promise<ResolvedOrder[]> {
    const rows = await this.handle.db
      .select()
      .from(canonicalEvents)
      .where(inArray(canonicalEvents.razorpayOrderId, [...orderIds]));

    const sensors = await this.sensorsFor(orderIds);

    const byOrder = new Map<string, AttemptEvent[]>();
    for (const row of rows) {
      if (row.razorpayOrderId === null) continue;
      const event: AttemptEvent = {
        eventType: row.eventType,
        razorpayPaymentId: row.razorpayPaymentId,
        razorpayOrderId: row.razorpayOrderId,
        status: row.status,
        method: row.method,
        errorCode: row.errorCode,
        errorReason: row.errorReason,
        errorSource: row.errorSource,
        errorStep: row.errorStep,
        errorDescription: row.errorDescription,
        cardNetwork: row.cardNetwork,
        cardIssuer: row.cardIssuer,
        amountPaise: row.amountPaise,
        eventAt: row.eventAt,
        late: row.late,
      };

      const existing = byOrder.get(row.razorpayOrderId);
      if (existing === undefined) byOrder.set(row.razorpayOrderId, [event]);
      else existing.push(event);
    }

    return [...byOrder.entries()]
      .map(([orderId, events]) => resolveOrder(orderId, events))
      .filter((order): order is Resolved => order !== null)
      .map((order) => this.serialise(order, sensors.get(order.razorpayOrderId) ?? null));
  }

  private serialise(order: Resolved, sensor: SensorContext | null): ResolvedOrder {
    return {
      razorpayOrderId: order.razorpayOrderId,
      outcome: order.outcome,
      recovered: order.recovered,
      amountPaise: order.amountPaise,
      firstSeenAt: order.firstSeenAt.toISOString(),
      lastSeenAt: order.lastSeenAt.toISOString(),
      failureCount: order.failureCount,
      sensor,
      attempts: order.attempts.map((attempt) => ({
        razorpayPaymentId: attempt.razorpayPaymentId,
        status: attempt.status,
        amountPaise: attempt.amountPaise,
        method: attempt.method,
        cardNetwork: attempt.cardNetwork,
        cardIssuer: attempt.cardIssuer,
        failure: attempt.failure,
        firstSeenAt: attempt.firstSeenAt.toISOString(),
        lastSeenAt: attempt.lastSeenAt.toISOString(),
        eventCount: attempt.eventCount,
        late: attempt.late,
      })),
    };
  }

  /** The storefront's record of who was asking, joined on the one key both halves share. */
  private async sensorsFor(orderIds: readonly string[]): Promise<Map<string, SensorContext>> {
    if (orderIds.length === 0) return new Map();

    const rows = await this.handle.db
      .select()
      .from(checkoutSessions)
      .where(inArray(checkoutSessions.razorpayOrderId, [...orderIds]));

    return new Map(
      rows.map((row) => [
        row.razorpayOrderId,
        {
          sessionFingerprint: fingerprint(row.sessionPseudonym),
          deviceFingerprint: fingerprint(row.devicePseudonym),
          ipFingerprint: fingerprint(row.ipPseudonym),
          userAgentFamily: row.userAgentFamily,
          itemCount: row.itemCount,
          createdAt: row.createdAt.toISOString(),
        },
      ]),
    );
  }

  /**
   * Checkouts that were started and never reached a terminal payment event, past the point
   * where a late arrival would still be expected.
   *
   * Recorded, not guessed at. Assuming an unresolved checkout failed would invent failures
   * that never happened — and a detector keyed on failure counts is the worst possible place
   * to invent one. A shopper who closes the tab before paying leaves exactly this trace.
   */
  private async unresolved(): Promise<UnresolvedAttempt[]> {
    const cutoff = new Date(Date.now() - this.env.ALLOWED_LATENESS_MINUTES * 60_000);

    const rows = await this.handle.db
      .select({
        razorpayOrderId: checkoutSessions.razorpayOrderId,
        amountPaise: checkoutSessions.amountPaise,
        createdAt: checkoutSessions.createdAt,
        itemCount: checkoutSessions.itemCount,
        sessionPseudonym: checkoutSessions.sessionPseudonym,
        devicePseudonym: checkoutSessions.devicePseudonym,
        ipPseudonym: checkoutSessions.ipPseudonym,
        userAgentFamily: checkoutSessions.userAgentFamily,
      })
      .from(checkoutSessions)
      .leftJoin(
        canonicalEvents,
        eq(canonicalEvents.razorpayOrderId, checkoutSessions.razorpayOrderId),
      )
      .where(and(isNull(canonicalEvents.id), lt(checkoutSessions.createdAt, cutoff)))
      .orderBy(desc(checkoutSessions.createdAt))
      .limit(50);

    const now = Date.now();
    return rows.map((row) => ({
      razorpayOrderId: row.razorpayOrderId,
      amountPaise: row.amountPaise,
      createdAt: row.createdAt.toISOString(),
      ageMinutes: Math.round((now - row.createdAt.getTime()) / 60_000),
      sensor: {
        sessionFingerprint: fingerprint(row.sessionPseudonym),
        deviceFingerprint: fingerprint(row.devicePseudonym),
        ipFingerprint: fingerprint(row.ipPseudonym),
        userAgentFamily: row.userAgentFamily,
        itemCount: row.itemCount,
        createdAt: row.createdAt.toISOString(),
      },
    }));
  }
}
