import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { auditLog, containments, users, type AuditLogRow, type DbHandle } from '@sentinel/db';
import {
  GENESIS_HASH,
  hashContent,
  verifyChain,
  type AuditContent,
  type ChainEntry,
  type VerifyResult,
} from '@sentinel/audit';
import { DB } from '../db/db.module.js';

export interface AppendInput {
  at?: Date;
  actorId?: string | null;
  kind: string;
  subjectType: string;
  subjectId: string;
  payload: unknown;
  policyVersion?: number | null;
  policyHash?: string | null;
  featureSnapshotHash?: string | null;
  modelVersion?: string | null;
}

/** One entry as the console reads it: the content, its place in the chain, and who did it. */
export interface AuditEntryView {
  seq: number;
  at: number;
  actor: string | null;
  kind: string;
  subjectType: string;
  subjectId: string;
  payload: unknown;
  policyVersion: number | null;
  policyHash: string | null;
  hash: string;
  prevHash: string;
}

const MAX_APPEND_ATTEMPTS = 5;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Appends an entry, linked to the current head.
   *
   * The read-then-write is retried on a unique-constraint violation because that violation *is*
   * the fork guard doing its job: two appends that both linked to the same head cannot both
   * exist, so the loser reads the new head and tries again. Under the embedded database this
   * never fires — one connection, no real concurrency — but the code is written for the database
   * it will run against in production, not the one the tests use.
   *
   * If this throws, the caller's request fails. That is deliberate: an action that happened
   * without an audit entry is worse than an action that did not happen, and silently swallowing
   * the failure would be the one bug this whole slice exists to make impossible.
   */
  async append(input: AppendInput): Promise<AuditLogRow> {
    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt += 1) {
      const [head] = await this.handle.db
        .select({ hash: auditLog.hash })
        .from(auditLog)
        .orderBy(desc(auditLog.seq))
        .limit(1);

      const prevHash = head?.hash ?? GENESIS_HASH;
      const at = input.at ?? new Date();
      const content: AuditContent = {
        at: at.toISOString(),
        actorId: input.actorId ?? null,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        payload: input.payload,
        policyVersion: input.policyVersion ?? null,
        policyHash: input.policyHash ?? null,
        featureSnapshotHash: input.featureSnapshotHash ?? null,
        modelVersion: input.modelVersion ?? null,
        prevHash,
      };
      const hash = hashContent(content);

      try {
        const [row] = await this.handle.db
          .insert(auditLog)
          .values({
            at,
            actorId: content.actorId,
            kind: content.kind,
            subjectType: content.subjectType,
            subjectId: content.subjectId,
            payload: content.payload,
            policyVersion: content.policyVersion,
            policyHash: content.policyHash,
            featureSnapshotHash: content.featureSnapshotHash,
            modelVersion: content.modelVersion,
            prevHash,
            hash,
          })
          .returning();
        return row!;
      } catch (error) {
        // A clash on prev_hash or hash means someone appended between our read and our write.
        if (attempt < MAX_APPEND_ATTEMPTS && isUniqueViolation(error)) {
          this.logger.debug(`audit append raced, retrying (attempt ${attempt})`);
          continue;
        }
        throw error;
      }
    }

    throw new Error('audit append could not acquire the chain head after several attempts');
  }

  /**
   * Walks the whole chain and reports the first place it stops adding up.
   *
   * Read in sequence order, which is both how the chain is meant to be read and one of the things
   * being checked — a database that returned them out of order would be caught by the same walk.
   */
  async verify(): Promise<VerifyResult> {
    const rows = await this.handle.db.select().from(auditLog).orderBy(asc(auditLog.seq));
    return verifyChain(rows.map(toChainEntry));
  }

  async list(subjectType?: string, subjectId?: string): Promise<AuditEntryView[]> {
    const filtered =
      subjectType !== undefined && subjectId !== undefined
        ? and(eq(auditLog.subjectType, subjectType), eq(auditLog.subjectId, subjectId))
        : undefined;

    const rows = await this.handle.db
      .select({
        seq: auditLog.seq,
        at: auditLog.at,
        kind: auditLog.kind,
        subjectType: auditLog.subjectType,
        subjectId: auditLog.subjectId,
        payload: auditLog.payload,
        policyVersion: auditLog.policyVersion,
        policyHash: auditLog.policyHash,
        hash: auditLog.hash,
        prevHash: auditLog.prevHash,
        actor: users.displayName,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(filtered)
      .orderBy(desc(auditLog.seq))
      .limit(200);

    return rows.map((row) => ({
      seq: Number(row.seq),
      at: row.at.getTime(),
      actor: row.actor,
      kind: row.kind,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      payload: row.payload,
      policyVersion: row.policyVersion,
      policyHash: row.policyHash,
      hash: row.hash,
      prevHash: row.prevHash,
    }));
  }

  /**
   * Everything that happened to one incident and to the actions taken on it.
   *
   * An incident's own transitions are recorded against the incident; the approvals, extensions
   * and releases are recorded against a containment. A per-incident view that showed only the
   * first would omit the half a reader most wants — what was actually done — so this gathers
   * both.
   */
  async listForIncident(incidentId: string): Promise<AuditEntryView[]> {
    const owned = await this.handle.db
      .select({ id: containments.id })
      .from(containments)
      .where(eq(containments.incidentId, incidentId));

    const containmentIds = owned.map((row) => row.id);
    const subjectMatch = or(
      and(eq(auditLog.subjectType, 'incident'), eq(auditLog.subjectId, incidentId)),
      containmentIds.length === 0
        ? undefined
        : and(eq(auditLog.subjectType, 'containment'), inArray(auditLog.subjectId, containmentIds)),
    );

    const rows = await this.handle.db
      .select({
        seq: auditLog.seq,
        at: auditLog.at,
        kind: auditLog.kind,
        subjectType: auditLog.subjectType,
        subjectId: auditLog.subjectId,
        payload: auditLog.payload,
        policyVersion: auditLog.policyVersion,
        policyHash: auditLog.policyHash,
        hash: auditLog.hash,
        prevHash: auditLog.prevHash,
        actor: users.displayName,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(subjectMatch)
      .orderBy(desc(auditLog.seq))
      .limit(200);

    return rows.map((row) => ({
      seq: Number(row.seq),
      at: row.at.getTime(),
      actor: row.actor,
      kind: row.kind,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      payload: row.payload,
      policyVersion: row.policyVersion,
      policyHash: row.policyHash,
      hash: row.hash,
      prevHash: row.prevHash,
    }));
  }
}

/** A stored row in the shape the pure verifier walks. `at` becomes the exact ISO string hashed. */
function toChainEntry(row: AuditLogRow): ChainEntry {
  return {
    at: row.at.toISOString(),
    actorId: row.actorId,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    payload: row.payload,
    policyVersion: row.policyVersion,
    policyHash: row.policyHash,
    featureSnapshotHash: row.featureSnapshotHash,
    modelVersion: row.modelVersion,
    prevHash: row.prevHash,
    seq: Number(row.seq),
    hash: row.hash,
  };
}

/** A Postgres unique-violation, however the driver happens to surface it. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === '23505') return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('unique') || message.includes('duplicate');
}
