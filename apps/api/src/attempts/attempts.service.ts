import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { canonicalEvents, checkoutSessions, incidents, type DbHandle } from '@sentinel/db';
import {
  firedRules,
  incidentTitle,
  type EntityKind,
  type Incident as ComputedIncident,
} from '@sentinel/detect';
import type {
  AttemptDetail,
  AttemptDetailPayment,
  AttemptDeviceRecent,
  AttemptIncidentLink,
  AttemptKpis,
  AttemptRow,
  AttemptRowsResponse,
  AttemptRowStatus,
  AttemptSignals,
  OrdersResponse,
  ResolvedOrder,
  SensorContext,
  UnresolvedAttempt,
} from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import {
  resolveAttempt,
  resolveOrder,
  type AttemptEvent,
  type ResolvedAttempt as ResolvedStateAttempt,
  type ResolvedOrder as Resolved,
} from './state.js';

/** How many recent orders the flat table resolves per read. A materialised projection replaces
 * this at volume; at demo and replay scale the resolve-on-read path keeps one truth. */
const ATTEMPT_ROW_SCAN_LIMIT = 1000;

type Severity = 'low' | 'medium' | 'high';
type RowIncidentLink = {
  incidentId: string;
  incidentRef: string;
  title: string;
};

/** A short, stable display reference for an incident — a formatting of its real id, not a new id. */
function incidentRef(id: string): string {
  return `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

/**
 * Eight characters of a keyed hash. Enough for a person to see that two orders came from the
 * same session; not an identifier in its own right, and not reversible into one.
 */
function fingerprint(pseudonym: string): string {
  return pseudonym.replace(/^v\d+:/, '').slice(0, 8);
}

/**
 * A distinctive tail of a card token id — the same short form the incident graph shows, so one card
 * reads the same on an attempt as it does in the correlation graph. The tail rather than the head:
 * card token ids share a common prefix, so the first characters collide across every card while the
 * last do not. Never the token itself.
 */
function cardToken(value: string): string {
  return value.replace(/^v\d+:/, '').slice(-8);
}

/** Projects a canonical event row into the pure resolver's event shape. */
function toAttemptEvent(row: {
  eventType: string;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  status: string | null;
  method: string | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  errorDescription: string | null;
  cardNetwork: string | null;
  cardIssuer: string | null;
  cardId: string | null;
  amountPaise: number | null;
  eventAt: Date;
  late: boolean;
}): AttemptEvent {
  return {
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
    cardId: row.cardId,
    amountPaise: row.amountPaise,
    eventAt: row.eventAt,
    late: row.late,
  };
}

/** Groups events by the payment they name, dropping any that name none. Preserves the element type. */
function groupByPayment<T extends AttemptEvent>(events: readonly T[]): Map<string, T[]> {
  const byPayment = new Map<string, T[]>();
  for (const event of events) {
    if (event.razorpayPaymentId === null) continue;
    const existing = byPayment.get(event.razorpayPaymentId);
    if (existing === undefined) byPayment.set(event.razorpayPaymentId, [event]);
    else existing.push(event);
  }
  return byPayment;
}

/**
 * The canonical event as stored, for the "raw event" panel. It is already the redacted
 * representation — no customer data ever reaches this table — and the card token id is shown only
 * as a short fingerprint here too, never the token itself.
 */
function rawEventView(row: {
  razorpayEventId: string;
  eventType: string;
  entityType: string | null;
  source: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  amountPaise: number | null;
  currency: string | null;
  status: string | null;
  method: string | null;
  errorCode: string | null;
  errorReason: string | null;
  errorSource: string | null;
  errorStep: string | null;
  cardNetwork: string | null;
  cardType: string | null;
  cardIssuer: string | null;
  cardId: string | null;
  international: boolean | null;
  eventAt: Date;
  late: boolean;
}): Record<string, unknown> {
  return {
    razorpayEventId: row.razorpayEventId,
    eventType: row.eventType,
    entityType: row.entityType,
    source: row.source,
    razorpayOrderId: row.razorpayOrderId,
    razorpayPaymentId: row.razorpayPaymentId,
    amountPaise: row.amountPaise,
    currency: row.currency,
    status: row.status,
    method: row.method,
    errorCode: row.errorCode,
    errorReason: row.errorReason,
    errorSource: row.errorSource,
    errorStep: row.errorStep,
    cardNetwork: row.cardNetwork,
    cardType: row.cardType,
    cardIssuer: row.cardIssuer,
    cardFingerprint: row.cardId !== null && row.cardId !== '' ? cardToken(row.cardId) : null,
    international: row.international,
    eventAt: row.eventAt.toISOString(),
    late: row.late,
  };
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
  // The two query shapes are intentionally explicit: unfiltered live reads and entity-scoped reads.
  // eslint-disable-next-line complexity
  async listOrders(
    limit = 50,
    filter?: {
      entityKind?: 'session' | 'device' | 'network';
      entityKey?: string;
      source: 'razorpay' | 'replay' | 'all';
    },
  ): Promise<OrdersResponse> {
    const entityColumn =
      filter?.entityKind === 'session'
        ? checkoutSessions.sessionPseudonym
        : filter?.entityKind === 'device'
          ? checkoutSessions.devicePseudonym
          : filter?.entityKind === 'network'
            ? checkoutSessions.ipPseudonym
            : null;
    const recent =
      filter === undefined || filter.entityKind === undefined || filter.entityKey === undefined
        ? await this.handle.db
            .selectDistinct({ orderId: canonicalEvents.razorpayOrderId })
            .from(canonicalEvents)
            .where(
              and(
                sql`${canonicalEvents.razorpayOrderId} is not null`,
                filter === undefined || filter.source === 'all'
                  ? sql`true`
                  : eq(canonicalEvents.source, filter.source),
              ),
            )
            .orderBy(desc(canonicalEvents.razorpayOrderId))
            .limit(limit)
        : await this.handle.db
            .selectDistinct({ orderId: canonicalEvents.razorpayOrderId })
            .from(canonicalEvents)
            .innerJoin(
              checkoutSessions,
              eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
            )
            .where(
              and(
                sql`${canonicalEvents.razorpayOrderId} is not null`,
                entityColumn === null ? sql`false` : eq(entityColumn, filter.entityKey),
                filter.source === 'all' ? sql`true` : eq(checkoutSessions.source, filter.source),
              ),
            )
            .limit(limit);

    const orderIds = recent
      .map((row) => row.orderId)
      .filter((id): id is string => id !== null && id !== '');

    const orders = orderIds.length === 0 ? [] : await this.resolveMany(orderIds);

    return {
      orders: orders.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)),
      unresolved: await this.unresolved(filter?.source ?? 'razorpay'),
      allowedLatenessMinutes: this.env.ALLOWED_LATENESS_MINUTES,
    };
  }

  async getOrder(razorpayOrderId: string): Promise<ResolvedOrder> {
    // resolveMany derives each order's source from its own events, so no separate lookup is needed.
    const [order] = await this.resolveMany([razorpayOrderId]);
    if (order === undefined) throw new NotFoundException(`No events for ${razorpayOrderId}`);
    return order;
  }

  /** Trailing window, in ms, for the per-attempt velocity and card-reuse observations. */
  private static readonly SIGNAL_WINDOW_MS = 60_000;
  /** Wider window, in ms, for the network-sharing observation — device rotation is slower than velocity. */
  private static readonly NETWORK_WINDOW_MS = 600_000;

  /**
   * Everything a merchant needs to understand one payment attempt: what happened to it, what was
   * observed around it, and whether it has become part of a correlated incident.
   *
   * Nothing here is a per-attempt fraud score. The attempt is described by facts — its resolved
   * status, the redacted event that produced it, the counts seen on its own device and network at
   * the moment it happened — and the only risk verdict comes from the incident it fell inside, if
   * one did. The observations are null, not zero, when there is no checkout context to see from:
   * inventing zeroes would read as "nothing was happening" when the truth is "we could not see".
   */
  async getAttemptDetail(paymentId: string): Promise<AttemptDetail> {
    const eventRows = await this.handle.db
      .select()
      .from(canonicalEvents)
      .where(eq(canonicalEvents.razorpayPaymentId, paymentId));
    if (eventRows.length === 0) throw new NotFoundException(`No events for ${paymentId}`);

    const source = eventRows[0]!.source;

    const resolved = resolveAttempt(eventRows.map(toAttemptEvent));
    if (resolved === null) throw new NotFoundException(`Cannot resolve ${paymentId}`);
    const orderId = resolved.razorpayOrderId;

    // The finer card cohort (type, token id, international) is dropped by the pure resolver, so it is
    // read straight off the canonical events here.
    const cardEvent = eventRows.find((row) => row.cardId !== null || row.cardNetwork !== null);
    const cardId = cardEvent?.cardId ?? null;
    const currency = eventRows.find((row) => row.currency !== null)?.currency ?? null;
    const payment = AttemptsService.buildPayment(
      paymentId,
      resolved,
      cardEvent,
      cardId,
      currency,
      source,
    );

    const context =
      orderId === null ? null : ((await this.sensorsFor([orderId])).get(orderId) ?? null);
    const keys = orderId === null ? undefined : (await this.pseudonymsFor([orderId])).get(orderId);

    let incident: AttemptIncidentLink | null = null;
    let signals: AttemptSignals | null = null;
    let recentFromDevice: AttemptDeviceRecent[] = [];
    if (keys !== undefined) {
      [incident, signals, recentFromDevice] = await Promise.all([
        this.attemptIncident(
          keys,
          source,
          resolved.firstSeenAt.getTime(),
          resolved.lastSeenAt.getTime(),
        ),
        this.attemptSignals(keys, source, cardId, resolved.lastSeenAt, resolved.amountPaise),
        this.recentFromDevice(keys.device, source, paymentId),
      ]);
    }

    return {
      payment,
      context,
      incident,
      signals,
      recentFromDevice,
      rawEvents: eventRows
        .slice()
        .sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime())
        .map(rawEventView),
    };
  }

  /** Assembles the payment view from the resolved attempt and the finer card cohort off its events. */
  private static buildPayment(
    paymentId: string,
    resolved: ResolvedStateAttempt,
    cardEvent: { cardType: string | null; international: boolean | null } | undefined,
    cardId: string | null,
    currency: string | null,
    source: 'razorpay' | 'replay',
  ): AttemptDetailPayment {
    return {
      paymentId,
      orderId: resolved.razorpayOrderId,
      amountPaise: resolved.amountPaise,
      currency,
      method: resolved.method,
      status: resolved.status,
      captured: resolved.status === 'captured',
      refunded: resolved.status === 'refunded',
      cardNetwork: resolved.cardNetwork,
      cardType: cardEvent?.cardType ?? null,
      cardIssuer: resolved.cardIssuer,
      cardFingerprint: cardId !== null && cardId !== '' ? cardToken(cardId) : null,
      international: cardEvent?.international ?? null,
      failure: resolved.failure,
      firstSeenAt: resolved.firstSeenAt.toISOString(),
      lastSeenAt: resolved.lastSeenAt.toISOString(),
      eventCount: resolved.eventCount,
      late: resolved.late,
      source,
    };
  }

  /** The incident this attempt falls inside, matched by entity and window exactly as the row link is. */
  private async attemptIncident(
    keys: { session: string; device: string; network: string },
    source: 'razorpay' | 'replay',
    first: number,
    last: number,
  ): Promise<AttemptIncidentLink | null> {
    const rows = await this.handle.db.select().from(incidents).where(eq(incidents.source, source));

    const match = rows.find(
      (inc) =>
        keys[inc.entityKind as EntityKind] === inc.entityKey &&
        last >= inc.firstAttemptAt.getTime() &&
        first <= inc.lastActivityAt.getTime(),
    );
    if (match === undefined) return null;

    const entityKind = match.entityKind as EntityKind;
    const counts = await this.entityDistincts(
      entityKind,
      match.entityKey,
      source,
      match.firstAttemptAt,
      match.lastActivityAt,
    );

    return {
      id: match.id,
      ref: incidentRef(match.id),
      title: AttemptsService.titleOf(match),
      severity: match.severity as Severity,
      status: match.status,
      entityKind,
      reason: AttemptsService.reasonFor(entityKind, AttemptsService.firedOf(match)),
      attempts: match.attempts ?? match.observations,
      distinctCards: match.distinctCards ?? null,
      distinctDevices: counts.devices,
      distinctSessions: counts.sessions,
      windowMs: Math.max(0, match.lastActivityAt.getTime() - match.firstAttemptAt.getTime()),
    };
  }

  /** Distinct devices and sessions that touched one incident's entity inside its activity window. */
  private async entityDistincts(
    entityKind: EntityKind,
    entityKey: string,
    source: 'razorpay' | 'replay',
    from: Date,
    to: Date,
  ): Promise<{ devices: number; sessions: number }> {
    const column =
      entityKind === 'session'
        ? checkoutSessions.sessionPseudonym
        : entityKind === 'device'
          ? checkoutSessions.devicePseudonym
          : checkoutSessions.ipPseudonym;
    const rows = await this.handle.db
      .select({
        device: checkoutSessions.devicePseudonym,
        session: checkoutSessions.sessionPseudonym,
      })
      .from(canonicalEvents)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .where(
        and(
          eq(column, entityKey),
          eq(canonicalEvents.source, source),
          gte(canonicalEvents.eventAt, from),
          lte(canonicalEvents.eventAt, to),
        ),
      );
    return {
      devices: new Set(rows.map((row) => row.device)).size,
      sessions: new Set(rows.map((row) => row.session)).size,
    };
  }

  /**
   * What was observed around this attempt at the moment it happened — real counts over its own
   * device and network in a window ending at its event time, never a verdict on the attempt itself.
   */
  private async attemptSignals(
    keys: { session: string; device: string; network: string },
    source: 'razorpay' | 'replay',
    cardId: string | null,
    observedAt: Date,
    amountPaise: number | null,
  ): Promise<AttemptSignals> {
    const at = observedAt.getTime();
    const windowStart = new Date(at - AttemptsService.SIGNAL_WINDOW_MS);
    const networkStart = new Date(at - AttemptsService.NETWORK_WINDOW_MS);
    const observed = new Date(at);

    // Every event from this device in the trailing minute, grouped into the payments it produced.
    const deviceEvents = await this.deviceEventsBetween(keys.device, source, windowStart, observed);
    const byPayment = groupByPayment(deviceEvents);
    let failuresInWindow = 0;
    for (const events of byPayment.values()) {
      if (resolveAttempt(events)?.status === 'failed') failuresInWindow += 1;
    }
    const attemptsInWindow = byPayment.size;

    // First time this device was ever seen, to say whether it predates the trailing window.
    const [firstSeen] = await this.handle.db
      .select({ first: sql<Date | null>`min(${canonicalEvents.eventAt})` })
      .from(canonicalEvents)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .where(
        and(eq(checkoutSessions.devicePseudonym, keys.device), eq(canonicalEvents.source, source)),
      );
    const firstSeenValue = firstSeen?.first ?? null;
    const firstSeenMs = firstSeenValue === null ? null : new Date(firstSeenValue).getTime();

    // Distinct devices seen on this network in the wider window — the honest network-sharing signal,
    // in place of an IP reputation lookup this system has no source for.
    const networkRows = await this.handle.db
      .select({ device: checkoutSessions.devicePseudonym })
      .from(canonicalEvents)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .where(
        and(
          eq(checkoutSessions.ipPseudonym, keys.network),
          eq(canonicalEvents.source, source),
          gte(canonicalEvents.eventAt, networkStart),
          lte(canonicalEvents.eventAt, observed),
        ),
      );

    // Times this exact card was tried in the trailing minute, anywhere — null when there was no card.
    let cardReuseInWindow: number | null = null;
    if (cardId !== null && cardId !== '') {
      const cardRows = await this.handle.db
        .select({ paymentId: canonicalEvents.razorpayPaymentId })
        .from(canonicalEvents)
        .where(
          and(
            eq(canonicalEvents.cardId, cardId),
            eq(canonicalEvents.source, source),
            gte(canonicalEvents.eventAt, windowStart),
            lte(canonicalEvents.eventAt, observed),
          ),
        );
      cardReuseInWindow = new Set(cardRows.map((row) => row.paymentId)).size;
    }

    const typical = await this.typicalAmount(source);

    return {
      observedAt: observed.toISOString(),
      windowSeconds: AttemptsService.SIGNAL_WINDOW_MS / 1000,
      attemptsInWindow,
      failuresInWindow,
      failureRate: attemptsInWindow === 0 ? null : failuresInWindow / attemptsInWindow,
      deviceSeenBefore: firstSeenMs !== null && firstSeenMs < windowStart.getTime(),
      networkDistinctDevices: new Set(networkRows.map((row) => row.device)).size,
      networkWindowSeconds: AttemptsService.NETWORK_WINDOW_MS / 1000,
      cardReuseInWindow,
      amountVsTypical: AttemptsService.classifyAmount(typical, amountPaise),
      typicalAmountPaise: typical,
    };
  }

  /** This amount against the shop's own typical: a wide band, so only a real outlier reads as one. */
  private static classifyAmount(
    typical: number | null,
    amountPaise: number | null,
  ): AttemptSignals['amountVsTypical'] {
    if (typical === null || amountPaise === null) return 'unknown';
    if (amountPaise < typical * 0.5) return 'below';
    if (amountPaise > typical * 1.5) return 'above';
    return 'typical';
  }

  /** The shop's own recent typical capture amount (median of the last captures), or null if too new. */
  private async typicalAmount(source: 'razorpay' | 'replay'): Promise<number | null> {
    const rows = await this.handle.db
      .select({ amount: canonicalEvents.amountPaise })
      .from(canonicalEvents)
      .where(
        and(
          eq(canonicalEvents.source, source),
          eq(canonicalEvents.status, 'captured'),
          sql`${canonicalEvents.amountPaise} is not null`,
        ),
      )
      .orderBy(desc(canonicalEvents.eventAt))
      .limit(500);
    const amounts = rows
      .map((row) => row.amount)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    if (amounts.length < 10) return null;
    const mid = Math.floor(amounts.length / 2);
    return amounts.length % 2 === 0
      ? Math.round((amounts[mid - 1]! + amounts[mid]!) / 2)
      : amounts[mid]!;
  }

  /** Recent distinct payment attempts from one device, most recent first, resolved to one status each. */
  private async recentFromDevice(
    deviceKey: string,
    source: 'razorpay' | 'replay',
    currentPaymentId: string,
  ): Promise<AttemptDeviceRecent[]> {
    const rows = await this.deviceEventsBetween(deviceKey, source, null, null);
    const byPayment = groupByPayment(rows);
    const recent: AttemptDeviceRecent[] = [];
    for (const [paymentId, events] of byPayment) {
      const resolved = resolveAttempt(events);
      if (resolved === null) continue;
      const card = events.find((event) => event.cardId !== null || event.cardNetwork !== null);
      const cardId = card?.cardId ?? null;
      recent.push({
        paymentId,
        at: resolved.firstSeenAt.toISOString(),
        amountPaise: resolved.amountPaise,
        cardNetwork: resolved.cardNetwork,
        cardFingerprint: cardId !== null && cardId !== '' ? cardToken(cardId) : null,
        status: AttemptsService.displayStatus(resolved.status, false),
        isCurrent: paymentId === currentPaymentId,
      });
    }
    return recent.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
  }

  /**
   * Canonical events from one device, as attempt events. `from`/`to` bound the window; passing null
   * for both reads the device's recent history (capped) for the "recent attempts" panel.
   */
  private async deviceEventsBetween(
    deviceKey: string,
    source: 'razorpay' | 'replay',
    from: Date | null,
    to: Date | null,
  ): Promise<(AttemptEvent & { cardId: string | null })[]> {
    const bounds = [
      eq(checkoutSessions.devicePseudonym, deviceKey),
      eq(canonicalEvents.source, source),
      ...(from === null ? [] : [gte(canonicalEvents.eventAt, from)]),
      ...(to === null ? [] : [lte(canonicalEvents.eventAt, to)]),
    ];
    const rows = await this.handle.db
      .select({
        eventType: canonicalEvents.eventType,
        razorpayPaymentId: canonicalEvents.razorpayPaymentId,
        razorpayOrderId: canonicalEvents.razorpayOrderId,
        status: canonicalEvents.status,
        method: canonicalEvents.method,
        errorCode: canonicalEvents.errorCode,
        errorReason: canonicalEvents.errorReason,
        errorSource: canonicalEvents.errorSource,
        errorStep: canonicalEvents.errorStep,
        errorDescription: canonicalEvents.errorDescription,
        cardNetwork: canonicalEvents.cardNetwork,
        cardIssuer: canonicalEvents.cardIssuer,
        cardId: canonicalEvents.cardId,
        amountPaise: canonicalEvents.amountPaise,
        eventAt: canonicalEvents.eventAt,
        late: canonicalEvents.late,
      })
      .from(canonicalEvents)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .where(and(...bounds))
      .orderBy(desc(canonicalEvents.eventAt))
      .limit(from === null && to === null ? 120 : 400);
    return rows.map((row) => ({ ...toAttemptEvent(row), cardId: row.cardId }));
  }

  private static firedOf(row: {
    evidence: unknown;
    firstAttemptAt: Date;
    detectedAt: Date;
  }): string[] {
    const computed = {
      detectedAt: row.detectedAt.getTime(),
      firstAttemptAt: row.firstAttemptAt.getTime(),
      score: { evidence: row.evidence },
    } as unknown as ComputedIncident;
    return firedRules(computed);
  }

  /** The plain-language reason an incident grouped its attempts, from its entity kind and rules. */
  private static reasonFor(entityKind: EntityKind, fired: readonly string[]): string {
    const has = (...names: string[]): boolean => names.some((name) => fired.includes(name));
    if (has('card_spread', 'card_spread_slow', 'card_probing')) {
      if (entityKind === 'device')
        return 'One device attempted many distinct cards in a short window.';
      if (entityKind === 'network')
        return 'Many distinct cards were tried across sessions from one network.';
      return 'One checkout session cycled through many distinct cards.';
    }
    if (has('velocity', 'machine_cadence'))
      return 'Payments arrived faster and more evenly than a person checking out.';
    if (has('approval_collapse', 'reason_mix'))
      return 'A run of declines well below this shop’s normal approval rate.';
    if (has('small_amount_probing'))
      return 'Repeated very-small-amount attempts, the shape of card validation.';
    return 'Several correlated attempts from one entity formed a pattern.';
  }

  /**
   * The flat attempts table: one row per resolved payment attempt, each linked to the incident
   * whose correlated entity and window it falls inside (if any) and carrying that incident's risk.
   *
   * KPIs are computed over the whole scoped set; filters and paging apply only to the rows shown.
   * An attempt that is part of no incident is not individually scored — it reads as low with no
   * number, never a fabricated score.
   */
  async listAttemptRows(input: {
    source: 'razorpay' | 'replay' | 'all';
    status: AttemptRowStatus | 'all';
    method: string;
    page: number;
    pageSize: number;
  }): Promise<AttemptRowsResponse> {
    const orders = await this.recentOrders(input.source, ATTEMPT_ROW_SCAN_LIMIT);
    const links = await this.incidentLinks(orders, input.source);

    const all = orders
      .flatMap((order) =>
        AttemptsService.rowsForOrder(order, links.get(order.razorpayOrderId) ?? null),
      )
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    const kpis = AttemptsService.kpis(all);
    const filtered = all.filter((row) => AttemptsService.matches(row, input));
    const start = (input.page - 1) * input.pageSize;

    return {
      rows: filtered.slice(start, start + input.pageSize),
      page: input.page,
      pageSize: input.pageSize,
      total: filtered.length,
      kpis,
      source: input.source,
    };
  }

  /** Distinct recent orders for a source, ordered by real recency (max event time), resolved. */
  private async recentOrders(
    source: 'razorpay' | 'replay' | 'all',
    limit: number,
  ): Promise<ResolvedOrder[]> {
    const recent = await this.handle.db
      .select({ orderId: canonicalEvents.razorpayOrderId })
      .from(canonicalEvents)
      .where(
        and(
          sql`${canonicalEvents.razorpayOrderId} is not null`,
          source === 'all' ? undefined : eq(canonicalEvents.source, source),
        ),
      )
      .groupBy(canonicalEvents.razorpayOrderId)
      .orderBy(desc(sql`max(${canonicalEvents.eventAt})`))
      .limit(limit);
    const orderIds = recent
      .map((row) => row.orderId)
      .filter((id): id is string => id !== null && id !== '');
    return orderIds.length === 0 ? [] : this.resolveMany(orderIds);
  }

  /** Maps each order to the incident it belongs to, by entity match and window overlap. */
  private async incidentLinks(
    orders: readonly ResolvedOrder[],
    source: 'razorpay' | 'replay' | 'all',
  ): Promise<Map<string, RowIncidentLink>> {
    if (orders.length === 0) return new Map();
    const pseudonyms = await this.pseudonymsFor(orders.map((o) => o.razorpayOrderId));
    const incs = await this.handle.db
      .select({
        id: incidents.id,
        source: incidents.source,
        entityKind: incidents.entityKind,
        entityKey: incidents.entityKey,
        firstAttemptAt: incidents.firstAttemptAt,
        detectedAt: incidents.detectedAt,
        lastActivityAt: incidents.lastActivityAt,
        evidence: incidents.evidence,
        arbitration: incidents.arbitration,
      })
      .from(incidents)
      .where(source === 'all' ? undefined : eq(incidents.source, source));

    const links = new Map<string, RowIncidentLink>();
    for (const order of orders) {
      const keys = pseudonyms.get(order.razorpayOrderId);
      if (keys === undefined) continue;
      const first = Date.parse(order.firstSeenAt);
      const last = Date.parse(order.lastSeenAt);
      // Detection is source-scoped: a live order links only to a live incident, a simulated order
      // only to a simulated one, even in the merged "both" view. Otherwise a real customer's attempt
      // could be swept into a simulated attack.
      const match = incs.find(
        (inc) =>
          inc.source === order.source &&
          keys[inc.entityKind as EntityKind] === inc.entityKey &&
          last >= inc.firstAttemptAt.getTime() &&
          first <= inc.lastActivityAt.getTime(),
      );
      if (match !== undefined) {
        links.set(order.razorpayOrderId, {
          incidentId: match.id,
          incidentRef: incidentRef(match.id),
          title: AttemptsService.titleOf(match),
        });
      }
    }
    return links;
  }

  /**
   * The incident's human title, derived on read from its stored evidence and arbitration exactly as
   * the incident queue derives it — so an attempt's "part of X" label always matches the incident's
   * own heading rather than drifting from it.
   */
  private static titleOf(row: {
    entityKind: string;
    evidence: unknown;
    arbitration: unknown;
    firstAttemptAt: Date;
    detectedAt: Date;
  }): string {
    const computed = {
      detectedAt: row.detectedAt.getTime(),
      firstAttemptAt: row.firstAttemptAt.getTime(),
      score: { evidence: row.evidence },
    } as unknown as ComputedIncident;
    const fired = firedRules(computed);
    const primaryHypothesis =
      (
        row.arbitration as {
          best?: Parameters<typeof incidentTitle>[0]['primaryHypothesis'];
        } | null
      )?.best ?? 'insufficient_evidence';
    return incidentTitle({ entityKind: row.entityKind, primaryHypothesis, firedRules: fired });
  }

  /** Full entity pseudonyms per order, for matching against incident entity keys. */
  private async pseudonymsFor(
    orderIds: readonly string[],
  ): Promise<Map<string, { session: string; device: string; network: string }>> {
    if (orderIds.length === 0) return new Map();
    const rows = await this.handle.db
      .select({
        orderId: checkoutSessions.razorpayOrderId,
        session: checkoutSessions.sessionPseudonym,
        device: checkoutSessions.devicePseudonym,
        network: checkoutSessions.ipPseudonym,
      })
      .from(checkoutSessions)
      .where(inArray(checkoutSessions.razorpayOrderId, [...orderIds]));
    return new Map(
      rows.map((row) => [
        row.orderId,
        { session: row.session, device: row.device, network: row.network },
      ]),
    );
  }

  private static rowsForOrder(order: ResolvedOrder, link: RowIncidentLink | null): AttemptRow[] {
    // Risk is a property of a correlated incident, never of a single attempt. An attempt reads as
    // part of an incident only through the one it belongs to; on its own there is nothing to score,
    // so the row carries a factual incident link or nothing at all — never an invented number.
    return order.attempts.map((attempt) => ({
      paymentId: attempt.razorpayPaymentId,
      orderId: order.razorpayOrderId,
      amountPaise: attempt.amountPaise,
      method: attempt.method,
      cardNetwork: attempt.cardNetwork,
      status: AttemptsService.displayStatus(attempt.status, order.recovered),
      source: order.source,
      incidentId: link?.incidentId ?? null,
      incidentRef: link?.incidentRef ?? null,
      incidentTitle: link?.title ?? null,
      at: attempt.firstSeenAt,
    }));
  }

  /** A captured attempt whose order had to recover from a prior failure reads as `recovered`. */
  private static displayStatus(status: string, recovered: boolean): AttemptRowStatus {
    if (status === 'failed') return 'failed';
    if (status === 'captured') return recovered ? 'recovered' : 'captured';
    if (status === 'authorized') return 'authorized';
    if (status === 'refunded') return 'refunded';
    return 'pending';
  }

  private static kpis(rows: readonly AttemptRow[]): AttemptKpis {
    let captured = 0;
    let failed = 0;
    let recovered = 0;
    let inIncident = 0;
    for (const row of rows) {
      if (row.status === 'captured') captured += 1;
      else if (row.status === 'failed') failed += 1;
      else if (row.status === 'recovered') recovered += 1;
      if (row.incidentId !== null) inIncident += 1;
    }
    return { total: rows.length, captured, failed, recovered, inIncident };
  }

  private static matches(
    row: AttemptRow,
    input: { status: AttemptRowStatus | 'all'; method: string },
  ): boolean {
    if (input.status !== 'all' && row.status !== input.status) return false;
    if (input.method !== 'all' && row.method !== input.method) return false;
    return true;
  }

  /** Resolves payment orders connected to one incident entity and activity window. */
  async listForEntity(input: {
    entityKind: 'session' | 'device' | 'network';
    entityKey: string;
    source: 'razorpay' | 'replay';
    from: number;
    to: number;
  }): Promise<ResolvedOrder[]> {
    const entityColumn =
      input.entityKind === 'session'
        ? checkoutSessions.sessionPseudonym
        : input.entityKind === 'device'
          ? checkoutSessions.devicePseudonym
          : checkoutSessions.ipPseudonym;
    const rows = await this.handle.db
      .selectDistinct({ orderId: canonicalEvents.razorpayOrderId })
      .from(canonicalEvents)
      .innerJoin(
        checkoutSessions,
        eq(checkoutSessions.razorpayOrderId, canonicalEvents.razorpayOrderId),
      )
      .where(
        and(
          eq(checkoutSessions.source, input.source),
          eq(entityColumn, input.entityKey),
          gte(canonicalEvents.eventAt, new Date(input.from)),
          lte(canonicalEvents.eventAt, new Date(input.to)),
        ),
      )
      .limit(100);
    const orderIds = rows
      .map((row) => row.orderId)
      .filter((id): id is string => id !== null && id !== '');
    return this.resolveMany(orderIds);
  }

  private async resolveMany(orderIds: readonly string[]): Promise<ResolvedOrder[]> {
    const rows = await this.handle.db
      .select()
      .from(canonicalEvents)
      .where(inArray(canonicalEvents.razorpayOrderId, [...orderIds]));

    const sensors = await this.sensorsFor(orderIds);

    // Each order's source is a fact about its own events, not the scope that was queried — so a
    // merged "both" view can badge every row by where it actually came from.
    const orderSource = new Map<string, 'razorpay' | 'replay'>();
    const byOrder = new Map<string, AttemptEvent[]>();
    for (const row of rows) {
      if (row.razorpayOrderId === null) continue;
      orderSource.set(row.razorpayOrderId, row.source);
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
        cardId: row.cardId,
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
      .map((order) =>
        this.serialise(
          order,
          sensors.get(order.razorpayOrderId) ?? null,
          orderSource.get(order.razorpayOrderId) ?? 'razorpay',
        ),
      );
  }

  private serialise(
    order: Resolved,
    sensor: SensorContext | null,
    source: 'razorpay' | 'replay',
  ): ResolvedOrder {
    return {
      razorpayOrderId: order.razorpayOrderId,
      source,
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
        cardFingerprint:
          attempt.cardId !== null && attempt.cardId !== '' ? cardToken(attempt.cardId) : null,
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
  private async unresolved(source: 'razorpay' | 'replay' | 'all'): Promise<UnresolvedAttempt[]> {
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
      .where(
        and(
          source === 'all' ? undefined : eq(checkoutSessions.source, source),
          isNull(canonicalEvents.id),
          lt(checkoutSessions.createdAt, cutoff),
        ),
      )
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
