import { Inject, Injectable } from '@nestjs/common';
import { gte, sql } from 'drizzle-orm';
import { checkoutSessions, type DbHandle } from '@sentinel/db';
import type { RiskAssessment } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';

const WINDOW_MS = 30 * 60_000;

interface RiskInput {
  session: string;
  device: string;
  network: string;
  amountPaise: number;
}

/**
 * A cheap, explainable pre-checkout layer. It intentionally uses only merchant-side context
 * available before Razorpay checkout opens; payment outcomes and card identifiers belong to the
 * post-webhook detector and are never guessed here.
 */
@Injectable()
export class TransactionRiskService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async assess(input: RiskInput, now = new Date()): Promise<RiskAssessment> {
    const since = new Date(now.getTime() - WINDOW_MS);
    const [row] = await this.handle.db
      .select({
        sessionAttempts: sql<number>`count(*) filter (where ${checkoutSessions.sessionPseudonym} = ${input.session})::int`,
        deviceAttempts: sql<number>`count(*) filter (where ${checkoutSessions.devicePseudonym} = ${input.device})::int`,
        networkAttempts: sql<number>`count(*) filter (where ${checkoutSessions.ipPseudonym} = ${input.network})::int`,
        connectedSessions: sql<number>`count(distinct ${checkoutSessions.sessionPseudonym}) filter (where ${checkoutSessions.ipPseudonym} = ${input.network})::int`,
        averageAmount: sql<number | null>`avg(${checkoutSessions.amountPaise})`,
      })
      .from(checkoutSessions)
      .where(gte(checkoutSessions.createdAt, since));

    return scorePreCheckout(
      {
        sessionAttempts: Number(row?.sessionAttempts ?? 0),
        deviceAttempts: Number(row?.deviceAttempts ?? 0),
        networkAttempts: Number(row?.networkAttempts ?? 0),
        connectedSessions: Number(row?.connectedSessions ?? 0),
        averageAmount:
          row?.averageAmount === null || row?.averageAmount === undefined
            ? null
            : Number(row.averageAmount),
      },
      input.amountPaise,
    );
  }
}

function scorePreCheckout(
  signals: Omit<RiskAssessment['signals'], 'recentFailures'> & { averageAmount: number | null },
  amountPaise: number,
): RiskAssessment {
  const reasons: string[] = [];
  let score = 0;
  const add = (amount: number, reason: string, condition: boolean): void => {
    if (!condition) return;
    score += amount;
    reasons.push(reason);
  };

  add(0.25, 'session_velocity_elevated', signals.sessionAttempts >= 3);
  add(0.2, 'device_velocity_elevated', signals.deviceAttempts >= 5);
  add(0.25, 'network_velocity_elevated', signals.networkAttempts >= 8);
  add(0.25, 'shared_network_cluster', signals.connectedSessions >= 4);
  add(
    0.1,
    'amount_above_recent_baseline',
    signals.averageAmount !== null && amountPaise >= signals.averageAmount * 4,
  );

  const bounded = Math.min(Number(score.toFixed(4)), 1);
  return {
    score: bounded,
    band: bounded >= 0.7 ? 'high' : bounded >= 0.35 ? 'medium' : 'low',
    // This is advisory. A pre-checkout risk signal never silently becomes an autonomous block.
    decision: bounded >= 0.35 ? 'review' : 'allow',
    basis: 'pre_checkout',
    reasons: reasons.length === 0 ? ['no_elevated_pre_checkout_signal'] : reasons,
    signals: { ...signals, recentFailures: 0 },
  };
}
