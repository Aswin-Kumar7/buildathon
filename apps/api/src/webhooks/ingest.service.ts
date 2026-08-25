import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { inboxEvents, type DbHandle } from '@sentinel/db';
import { DB } from '../db/db.module.js';
import { loadEnv } from '../config/env.js';
import { seal, toKey } from '../telemetry/envelope.js';
import { deduplicationKey, verifySignature } from './signature.js';
import { toEventTime, webhookEnvelopeSchema } from './redact.js';

export interface IngestHeaders {
  signature: string | undefined;
  eventId: string | undefined;
}

export interface IngestResult {
  razorpayEventId: string;
  /** False when this delivery was a redelivery of an event already stored. */
  stored: boolean;
  late: boolean;
}

@Injectable()
export class IngestService {
  private readonly env = loadEnv();

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  get isConfigured(): boolean {
    const { RAZORPAY_WEBHOOK_SECRET, PAYLOAD_KEY_V1 } = this.env;
    return (
      RAZORPAY_WEBHOOK_SECRET !== undefined &&
      RAZORPAY_WEBHOOK_SECRET !== '' &&
      PAYLOAD_KEY_V1 !== undefined &&
      PAYLOAD_KEY_V1 !== ''
    );
  }

  /**
   * The watermark: the newest event time we have seen, less the allowed-lateness bound.
   *
   * Derived rather than stored. `max()` over an append-only table is monotonic by
   * construction, so there is no counter to get out of step with the data — and no way for
   * a restart to resume with a watermark ahead of what the table actually contains.
   */
  async watermark(): Promise<Date | null> {
    const [row] = await this.handle.db
      .select({ newest: sql<Date | null>`max(${inboxEvents.eventAt})` })
      .from(inboxEvents);

    const newest = row?.newest ?? null;
    if (newest === null) return null;

    return new Date(new Date(newest).getTime() - this.env.ALLOWED_LATENESS_MINUTES * 60_000);
  }

  /**
   * Verify, persist, commit — and only then may the caller answer 2xx.
   *
   * The order is the point. Acknowledging before the durable write means a process that
   * dies in between loses the event permanently: Razorpay has already had its 2xx and will
   * never send it again. A single indexed insert is a few milliseconds, so this sits three
   * orders of magnitude inside the five-second contract.
   */
  async ingest(rawBody: Buffer, headers: IngestHeaders): Promise<IngestResult> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Webhook ingestion is not configured. Set RAZORPAY_WEBHOOK_SECRET and PAYLOAD_KEY_V1.',
      );
    }

    // Verified before anything is parsed or written. An unsigned delivery leaves no trace
    // at all, so an attacker cannot fill the inbox with rows we have to reason about.
    if (!verifySignature(rawBody, headers.signature, this.env.RAZORPAY_WEBHOOK_SECRET ?? '')) {
      throw new UnauthorizedException('Signature verification failed');
    }

    let envelope;
    try {
      envelope = webhookEnvelopeSchema.parse(JSON.parse(rawBody.toString('utf8')));
    } catch {
      // Signed but unparseable. Retrying will not help, so say so rather than inviting
      // 24 hours of redelivery.
      throw new BadRequestException('Webhook body is not a recognisable Razorpay event');
    }

    const receivedAt = new Date();
    const eventAt = toEventTime(envelope.created_at, receivedAt);
    const mark = await this.watermark();
    const late = mark !== null && eventAt < mark;

    const sealed = seal(
      rawBody.toString('utf8'),
      toKey(this.env.PAYLOAD_KEY_V1 ?? ''),
      this.env.PAYLOAD_KEY_VERSION,
    );

    const razorpayEventId = deduplicationKey(rawBody, headers.eventId);

    // A redelivery increments the counter instead of inserting a second row. The unique
    // constraint is what makes at-least-once delivery safe; counting the collisions is the
    // only honest way to report a duplicate rate, and it costs one column.
    const inserted = await this.handle.db
      .insert(inboxEvents)
      .values({
        razorpayEventId,
        eventType: envelope.event,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        wrappedKey: sealed.wrappedKey,
        wrappedKeyIv: sealed.wrappedKeyIv,
        wrappedKeyTag: sealed.wrappedKeyTag,
        keyVersion: sealed.keyVersion,
        eventAt,
        receivedAt,
        late,
      })
      .onConflictDoUpdate({
        target: inboxEvents.razorpayEventId,
        set: {
          deliveryCount: sql`${inboxEvents.deliveryCount} + 1`,
          lastDeliveredAt: receivedAt,
        },
      })
      .returning();

    const row = inserted[0];
    return { razorpayEventId, stored: (row?.deliveryCount ?? 1) === 1, late };
  }
}
