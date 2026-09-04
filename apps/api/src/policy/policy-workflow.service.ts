import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { users } from '@sentinel/db';
import { InvalidPolicy, parsePolicy, policyHash, type Policy } from '@sentinel/policy';
import type { PolicyVersion, PolicyVersionListResponse } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { PolicyService } from './policy.service.js';

type WorkflowRow = {
  id: string;
  version: number;
  hash: string;
  status: PolicyVersion['status'];
  created_by: string;
  approved_by: string | null;
  created_at: Date | string;
  approved_at: Date | string | null;
  published_at: Date | string | null;
  source: string;
};

// Drizzle's postgres-js adapter returns rows as an array, while PGlite exposes a QueryResult.
// Keep workflow startup and policy actions portable across both supported local drivers.
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (typeof result === 'object' && result !== null && 'rows' in result) {
    return ((result as { rows?: unknown }).rows ?? []) as T[];
  }
  return [];
}

@Injectable()
export class PolicyWorkflowService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly handle: import('@sentinel/db').DbHandle,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const result = await this.handle.db.execute(sql`
      SELECT source FROM sentinel.policy_versions
      WHERE status = 'published' ORDER BY version DESC LIMIT 1
    `);
    const source = rowsOf<{ source: string }>(result)[0]?.source;
    if (source !== undefined) this.policy.activate(this.validate(source));
  }

  async list(): Promise<PolicyVersionListResponse> {
    const result = await this.handle.db.execute(sql`
      SELECT id, version, hash, status, created_by, approved_by, created_at, approved_at, published_at, source
      FROM sentinel.policy_versions ORDER BY version DESC LIMIT 50
    `);
    const rows = rowsOf<WorkflowRow>(result);
    const names = await this.namesFor(rows.flatMap((row) => [row.created_by, row.approved_by]));
    return { versions: rows.map((row) => this.view(row, names)) };
  }

  /** Resolves actor ids to display names, so history reads as people rather than uuids. */
  private async namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null && id !== ''))];
    if (unique.length === 0) return new Map();
    const rows = await this.handle.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * Saves a policy and makes it live in one step.
   *
   * There is no draft/submit/approve/publish ladder any more: a save writes a new version, records
   * it in the audit chain and activates it immediately. What replaces dual control is that the
   * history is append-only and every version keeps its full source, so any earlier policy can be
   * brought back with `revert` — recovery rather than prevention. The separate runtime setting
   * "require approval before blocking" is untouched; that one still governs whether a *shopper* can
   * be blocked without a person agreeing, which is a different question from who may edit policy.
   */
  async save(source: string, actorId: string): Promise<PolicyVersion> {
    const parsed = this.validate(source);
    const nextResult = await this.handle.db.execute(sql`
      SELECT COALESCE(MAX(version), ${this.policy.version}) + 1 AS next_version
      FROM sentinel.policy_versions
    `);
    const next = Number(rowsOf<{ next_version: number }>(nextResult)[0]?.next_version);
    if (parsed.version !== next) throw new BadRequestException(`policy version must be ${next}`);

    return this.commit(source, parsed, actorId, {
      kind: 'policy.published',
      payload: { version: parsed.version, hash: policyHash(parsed) },
    });
  }

  /**
   * Brings an earlier version back by writing it forward as a new one.
   *
   * The same shape as `git revert`: nothing in the history is edited or deleted, so the record of
   * what was live and when stays true. Reverting to the version that is already live is refused
   * rather than quietly writing an identical duplicate into the history.
   */
  async revert(id: string, actorId: string): Promise<PolicyVersion> {
    const row = await this.require(id);
    const restored = this.validate(row.source);
    if (policyHash(restored) === this.policy.fingerprint) {
      throw new ConflictException('that policy version is already the live one');
    }
    const nextResult = await this.handle.db.execute(sql`
      SELECT COALESCE(MAX(version), ${this.policy.version}) + 1 AS next_version
      FROM sentinel.policy_versions
    `);
    const next = Number(rowsOf<{ next_version: number }>(nextResult)[0]?.next_version);
    // The document carries its own version number, so the restored source is renumbered forward.
    const source = row.source.replace(/^version:\s*\d+/m, `version: ${next}`);
    const parsed = this.validate(source);

    return this.commit(source, parsed, actorId, {
      kind: 'policy.reverted',
      payload: {
        version: parsed.version,
        hash: policyHash(parsed),
        revertedToVersion: row.version,
        revertedToHash: row.hash,
      },
    });
  }

  /** Writes a version as live, activates it, and records it. Shared by save and revert. */
  private async commit(
    source: string,
    parsed: Policy,
    actorId: string,
    entry: { kind: string; payload: Record<string, unknown> },
  ): Promise<PolicyVersion> {
    const hash = policyHash(parsed);
    const result = await this.handle.db.execute(sql`
      INSERT INTO sentinel.policy_versions (version, hash, source, status, created_by, published_at)
      VALUES (${parsed.version}, ${hash}, ${source}, 'published', ${actorId}, now())
      RETURNING id, version, hash, status, created_by, approved_by, created_at, approved_at, published_at, source
    `);
    const row = rowsOf<WorkflowRow>(result)[0];
    if (row === undefined) throw new ConflictException('policy could not be saved');

    this.policy.activate(parsed);
    await this.audit.append({
      actorId,
      kind: entry.kind,
      subjectType: 'policy_version',
      subjectId: row.id,
      payload: entry.payload,
      policyVersion: row.version,
      policyHash: row.hash,
    });
    return this.view(row);
  }

  private validate(source: string): Policy {
    try {
      return parsePolicy(source);
    } catch (error) {
      throw new BadRequestException(
        error instanceof InvalidPolicy ? error.problems : [(error as Error).message],
      );
    }
  }

  private async require(id: string): Promise<WorkflowRow> {
    const result = await this.handle.db.execute(sql`
      SELECT id, version, hash, status, created_by, approved_by, created_at, approved_at, published_at, source
      FROM sentinel.policy_versions WHERE id = ${id} LIMIT 1
    `);
    const row = rowsOf<WorkflowRow>(result)[0];
    if (row === undefined) throw new NotFoundException('no such policy version');
    return row;
  }

  private view(row: WorkflowRow, names: Map<string, string> = new Map()): PolicyVersion {
    const millis = (value: Date | string | null): number | null =>
      value === null ? null : new Date(value).getTime();
    return {
      id: row.id,
      version: row.version,
      hash: row.hash,
      status: row.status,
      createdBy: row.created_by,
      createdByName: names.get(row.created_by) ?? null,
      approvedBy: row.approved_by,
      approvedByName: row.approved_by === null ? null : (names.get(row.approved_by) ?? null),
      createdAt: millis(row.created_at)!,
      approvedAt: millis(row.approved_at),
      publishedAt: millis(row.published_at),
      settings: PolicyWorkflowService.settingsOf(row.source),
    };
  }

  /**
   * The handful of settings worth showing beside a version in history, so restoring is an informed
   * choice rather than a leap. Parsed here rather than in the browser — the console never sees the
   * YAML. A version whose stored source no longer parses reports null instead of a guess.
   */
  private static settingsOf(source: string): PolicyVersion['settings'] {
    try {
      const parsed = parsePolicy(source);
      return {
        stepUp: parsed.thresholds.stepUp,
        contain: parsed.thresholds.contain,
        defaultMinutes: parsed.containment.defaultMinutes,
        maxMinutes: parsed.containment.maxMinutes,
        containmentAlwaysNeedsApproval: parsed.approval.containmentAlwaysNeedsApproval,
        dualApprovalAbovePaise: parsed.approval.dualApprovalAbovePaise,
      };
    } catch {
      return null;
    }
  }
}
