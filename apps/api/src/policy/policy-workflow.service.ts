import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
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
    const source = (result as unknown as { rows: [{ source: string }] }).rows[0]?.source;
    if (source !== undefined) this.policy.activate(this.validate(source));
  }

  async list(): Promise<PolicyVersionListResponse> {
    const result = await this.handle.db.execute(sql`
      SELECT id, version, hash, status, created_by, approved_by, created_at, approved_at, published_at, source
      FROM sentinel.policy_versions ORDER BY version DESC LIMIT 50
    `);
    return {
      versions: (result as unknown as { rows: WorkflowRow[] }).rows.map((row) => this.view(row)),
    };
  }

  async create(source: string, actorId: string): Promise<PolicyVersion> {
    const parsed = this.validate(source);
    const latestResult = await this.handle.db.execute(sql`
      SELECT COALESCE(MAX(version), ${this.policy.version}) + 1 AS next_version
      FROM sentinel.policy_versions
    `);
    const latest = (latestResult as unknown as { rows: [{ next_version: number }] }).rows[0];
    const result = await this.handle.db.execute(sql`
      INSERT INTO sentinel.policy_versions (version, hash, source, status, created_by)
      VALUES (${parsed.version}, ${policyHash(parsed)}, ${source}, 'draft', ${actorId})
      RETURNING id, version, hash, status, created_by, approved_by, created_at, approved_at, published_at, source
    `);
    const row = (result as unknown as { rows: WorkflowRow[] }).rows[0];
    if (row === undefined) throw new ConflictException('policy draft could not be created');
    // The document version is required to be the next repository version, not a stale copied value.
    if (parsed.version !== Number(latest?.next_version)) {
      await this.handle.db.execute(sql`DELETE FROM sentinel.policy_versions WHERE id = ${row.id}`);
      throw new BadRequestException(`policy version must be ${Number(latest?.next_version)}`);
    }
    await this.audit.append({
      actorId,
      kind: 'policy.draft_created',
      subjectType: 'policy_version',
      subjectId: row.id,
      payload: { version: row.version, hash: row.hash },
      policyVersion: row.version,
      policyHash: row.hash,
    });
    return this.view(row);
  }

  async submit(id: string, actorId: string): Promise<PolicyVersion> {
    const row = await this.require(id);
    if (row.status !== 'draft')
      throw new BadRequestException(`a ${row.status} policy cannot be submitted`);
    await this.handle.db.execute(
      sql`UPDATE sentinel.policy_versions SET status = 'pending_approval' WHERE id = ${id}`,
    );
    await this.audit.append({
      actorId,
      kind: 'policy.submitted',
      subjectType: 'policy_version',
      subjectId: id,
      payload: { version: row.version },
      policyVersion: row.version,
      policyHash: row.hash,
    });
    return this.view({ ...row, status: 'pending_approval' });
  }

  async approve(id: string, actorId: string): Promise<PolicyVersion> {
    const row = await this.require(id);
    if (row.status !== 'pending_approval')
      throw new BadRequestException(`a ${row.status} policy cannot be approved`);
    if (row.created_by === actorId)
      throw new BadRequestException('the author cannot approve their own policy');
    await this.handle.db.execute(
      sql`UPDATE sentinel.policy_versions SET status = 'approved', approved_by = ${actorId}, approved_at = now() WHERE id = ${id}`,
    );
    await this.audit.append({
      actorId,
      kind: 'policy.approved',
      subjectType: 'policy_version',
      subjectId: id,
      payload: { version: row.version },
      policyVersion: row.version,
      policyHash: row.hash,
    });
    return this.view({ ...row, status: 'approved', approved_by: actorId, approved_at: new Date() });
  }

  async reject(id: string, actorId: string): Promise<PolicyVersion> {
    const row = await this.require(id);
    if (row.status !== 'pending_approval') {
      throw new BadRequestException(`a ${row.status} policy cannot be rejected`);
    }
    await this.handle.db.execute(
      sql`UPDATE sentinel.policy_versions SET status = 'rejected' WHERE id = ${id}`,
    );
    await this.audit.append({
      actorId,
      kind: 'policy.rejected',
      subjectType: 'policy_version',
      subjectId: id,
      payload: { version: row.version },
      policyVersion: row.version,
      policyHash: row.hash,
    });
    return this.view({ ...row, status: 'rejected' });
  }

  async publish(id: string, actorId: string): Promise<PolicyVersion> {
    const row = await this.require(id);
    if (row.status !== 'approved')
      throw new BadRequestException(`a ${row.status} policy cannot be published`);
    const parsed = this.validate(row.source);
    this.policy.activate(parsed);
    await this.handle.db.execute(
      sql`UPDATE sentinel.policy_versions SET status = 'published', published_at = now() WHERE id = ${id}`,
    );
    await this.audit.append({
      actorId,
      kind: 'policy.published',
      subjectType: 'policy_version',
      subjectId: id,
      payload: { version: row.version },
      policyVersion: row.version,
      policyHash: row.hash,
    });
    return this.view({ ...row, status: 'published', published_at: new Date() });
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
    const row = (result as unknown as { rows: WorkflowRow[] }).rows[0];
    if (row === undefined) throw new NotFoundException('no such policy version');
    return row;
  }

  private view(row: WorkflowRow): PolicyVersion {
    const millis = (value: Date | string | null): number | null =>
      value === null ? null : new Date(value).getTime();
    return {
      id: row.id,
      version: row.version,
      hash: row.hash,
      status: row.status,
      createdBy: row.created_by,
      approvedBy: row.approved_by,
      createdAt: millis(row.created_at)!,
      approvedAt: millis(row.approved_at),
      publishedAt: millis(row.published_at),
    };
  }
}
