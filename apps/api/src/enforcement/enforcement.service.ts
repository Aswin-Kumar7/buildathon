import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { enforcementEvents, users, type DbHandle } from '@sentinel/db';
import type { EnforcementState } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * A fixed subject id for enforcement events on the audit chain. The chain keys entries to a uuid
 * subject; the emergency stop is a system-level control with no per-row subject, so every pause and
 * resume is filed under this one, stable id.
 */
const ENFORCEMENT_SUBJECT = '00000000-0000-0000-0000-0000000000e5';

/**
 * The operator's emergency stop, held in memory and backed by an append-only log.
 *
 * Distinct from the policy kill switch. That is a reviewed policy value, changed slowly through the
 * draft→approve→publish workflow; this is an operational action one operator takes in an emergency,
 * instantly — because the direction it moves in (stop blocking) is the customer-protective one.
 *
 * The flag is loaded from the log at boot, so a restart never silently resumes enforcement: a paused
 * system comes back paused until someone resumes it on the record. The in-memory copy is what the
 * checkout hot path reads, so asking "are we paused" costs nothing per attempt.
 */
@Injectable()
export class EnforcementService implements OnModuleInit {
  private readonly logger = new Logger(EnforcementService.name);
  private paused = false;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const [latest] = await this.handle.db
      .select({ kind: enforcementEvents.kind })
      .from(enforcementEvents)
      .orderBy(desc(enforcementEvents.at))
      .limit(1);
    this.paused = latest?.kind === 'paused';
    if (this.paused) {
      this.logger.warn(
        'enforcement is PAUSED — restored from the log at boot; nobody is being blocked',
      );
    }
  }

  /** Synchronous and in-memory, so it is safe to call on the checkout path for every attempt. */
  isPaused(): boolean {
    return this.paused;
  }

  async state(): Promise<EnforcementState> {
    const [latest] = await this.handle.db
      .select({
        kind: enforcementEvents.kind,
        reason: enforcementEvents.reason,
        at: enforcementEvents.at,
        by: users.displayName,
      })
      .from(enforcementEvents)
      .leftJoin(users, eq(users.id, enforcementEvents.actorId))
      .orderBy(desc(enforcementEvents.at))
      .limit(1);

    if (latest === undefined) return { paused: false, since: null, by: null, reason: null };
    return {
      paused: latest.kind === 'paused',
      since: latest.at.toISOString(),
      by: latest.by,
      reason: latest.reason,
    };
  }

  async pause(actorId: string, reason?: string): Promise<EnforcementState> {
    await this.record('paused', actorId, reason);
    this.paused = true;
    this.logger.warn(`enforcement PAUSED by ${actorId}${reason ? ` — ${reason}` : ''}`);
    return this.state();
  }

  async resume(actorId: string, reason?: string): Promise<EnforcementState> {
    await this.record('resumed', actorId, reason);
    this.paused = false;
    this.logger.log(`enforcement RESUMED by ${actorId}${reason ? ` — ${reason}` : ''}`);
    return this.state();
  }

  private async record(
    kind: 'paused' | 'resumed',
    actorId: string,
    reason?: string,
  ): Promise<void> {
    await this.handle.db.insert(enforcementEvents).values({
      kind,
      actorId,
      ...(reason === undefined || reason === '' ? {} : { reason }),
    });
    await this.audit.append({
      actorId,
      kind: `enforcement.${kind}`,
      subjectType: 'enforcement',
      subjectId: ENFORCEMENT_SUBJECT,
      payload: { reason: reason ?? null },
    });
  }
}
