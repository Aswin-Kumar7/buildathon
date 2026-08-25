import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { containmentEvents, containments, incidents, users, type DbHandle } from '@sentinel/db';
import {
  computeFeatures,
  computeTraffic,
  type Arbitration,
  type EntityKind,
} from '@sentinel/detect';
import {
  decide,
  isCustomerImpacting,
  type PolicyDecision,
  type SystemState,
} from '@sentinel/policy';
import type { ContainmentDto, PolicyDecisionDto } from '@sentinel/contracts';
import { DB } from '../db/db.module.js';
import { FeaturesService } from '../features/features.service.js';
import { PolicyService } from '../policy/policy.service.js';

type Row = typeof containments.$inferSelect;

/** Statuses that still count against the impact caps. */
const LIVE = ['proposed', 'active'] as const;

@Injectable()
export class ContainmentService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    private readonly features: FeaturesService,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Asks the policy what may be done about an incident, and records the answer.
   *
   * Recorded even when the answer is "nothing". A refusal is the more interesting output of the
   * two — an analyst looking at an incident that was left alone needs to see *which rule* left
   * it alone, and a system that only writes a row when it acts cannot tell them.
   */
  async propose(incidentId: string, actorId: string, note?: string): Promise<ContainmentDto> {
    const [incident] = await this.handle.db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .limit(1);
    if (incident === undefined) throw new NotFoundException('no such incident');

    const arbitration = incident.arbitration as Arbitration | null;
    if (arbitration === null) {
      throw new BadRequestException(
        'this incident has no arbitration, so there is nothing to base a decision on',
      );
    }

    const existing = await this.handle.db
      .select({ id: containments.id })
      .from(containments)
      .where(and(eq(containments.incidentId, incidentId), inArray(containments.status, [...LIVE])))
      .limit(1);
    if (existing.length > 0) {
      throw new ConflictException('this incident already has a proposal or an active action');
    }

    const decision = await this.decideFor(
      incident.entityKind as EntityKind,
      incident.entityKey,
      arbitration,
      incident.source,
    );

    const [row] = await this.handle.db
      .insert(containments)
      .values({
        incidentId,
        entityKind: incident.entityKind,
        entityKey: incident.entityKey,
        action: decision.action,
        // Anything the shopper would not notice needs nobody's permission and takes effect at
        // once; there is nothing to approve about deciding to watch something.
        status: decision.approvalsRequired === 0 ? 'active' : 'proposed',
        approvalsRequired: decision.approvalsRequired,
        decision,
        policyVersion: decision.policyVersion,
        policyHash: decision.policyHash,
        proposedBy: actorId,
        ...(decision.approvalsRequired === 0 ? { activatedAt: sql`now()` } : {}),
        ...(decision.approvalsRequired === 0 && decision.expiresAfterMinutes !== null
          ? { expiresAt: sql`now() + make_interval(mins => ${decision.expiresAfterMinutes})` }
          : {}),
      })
      .returning();

    await this.record(row!.id, 'proposed', actorId, note);
    if (decision.approvalsRequired === 0) await this.record(row!.id, 'activated', null, null);

    return this.detail(row!.id);
  }

  /**
   * Runs the policy against current features for one entity.
   *
   * The clock it stands at depends on where the traffic came from, and the distinction matters.
   * For real traffic, "how old is our information" is a wall-clock question and staleness must
   * be measured against it — a pipeline that has fallen an hour behind must not be blocking
   * anybody. A replayed scenario carries the timestamps it was recorded with, so measuring it
   * the same way makes every rehearsal months stale and the degradation matrix refuses
   * everything: correct, and it would mean the approval flow could never be exercised or shown.
   *
   * So a replayed incident is judged standing at the moment of its own data, and the decision
   * says so. A containment against a replayed session blocks nobody; pretending it was decided
   * in the present would be the dishonest half of this, and it is what the reason code prevents.
   */
  private async decideFor(
    entityKind: EntityKind,
    entityKey: string,
    arbitration: Arbitration,
    source: 'razorpay' | 'replay',
  ): Promise<PolicyDecision> {
    const ranked = await this.features.rank(entityKind, 1, 'all');
    const vector = computeFeatures(
      entityKind,
      entityKey,
      ranked.observations,
      ranked.asOf,
      undefined,
      true,
    );
    const traffic = computeTraffic(ranked.observations, ranked.asOf);

    const rehearsal = source === 'replay';
    const state: SystemState = {
      now: rehearsal ? ranked.asOf : ranked.generatedAt,
      featuresAsOf: ranked.asOf,
      activeContainments: await this.countLive(),
      containmentsInLastHour: await this.countRecent(),
    };

    const decision = decide({ arbitration, vector, traffic, state, policy: this.policy.policy });
    return rehearsal
      ? { ...decision, reasons: [...decision.reasons, 'evaluated_in_replay_time'] }
      : decision;
  }

  private async countLive(): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(containments)
      .where(and(eq(containments.status, 'active'), sql`${containments.action} = 'contain'`));

    return Number(row?.n ?? 0);
  }

  private async countRecent(): Promise<number> {
    const [row] = await this.handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(containments)
      .where(
        and(
          sql`${containments.action} = 'contain'`,
          gte(containments.proposedAt, new Date(Date.now() - 3_600_000)),
        ),
      );

    return Number(row?.n ?? 0);
  }

  /**
   * One person agrees.
   *
   * The same person agreeing twice is refused, which is the entire content of "dual approval" —
   * without it the requirement is a counter anybody can satisfy alone, and the control would be
   * decorative.
   */
  async approve(id: string, actorId: string, note?: string): Promise<ContainmentDto> {
    const row = await this.require(id);
    if (row.status !== 'proposed') {
      throw new BadRequestException(`a ${row.status} action cannot be approved`);
    }

    // The kill switch is checked again here, not only at proposal. An approval granted before it
    // was engaged must not be a way of acting after.
    if (this.policy.policy.killSwitch) {
      throw new BadRequestException('the kill switch is engaged: nothing may take effect');
    }

    const approvers = await this.approvers(id);
    if (approvers.includes(actorId)) {
      throw new BadRequestException('you have already approved this one');
    }

    await this.record(id, 'approved', actorId, note);
    const total = approvers.length + 1;
    if (total < row.approvalsRequired) return this.detail(id);

    const minutes = (row.decision as PolicyDecisionDto).expiresAfterMinutes;
    await this.handle.db
      .update(containments)
      .set({
        status: 'active',
        activatedAt: sql`now()`,
        ...(minutes === null ? {} : { expiresAt: sql`now() + make_interval(mins => ${minutes})` }),
      })
      .where(eq(containments.id, id));

    await this.record(id, 'activated', null, null);
    return this.detail(id);
  }

  async reject(id: string, actorId: string, note?: string): Promise<ContainmentDto> {
    const row = await this.require(id);
    if (row.status !== 'proposed') {
      throw new BadRequestException(`a ${row.status} action cannot be rejected`);
    }

    await this.handle.db
      .update(containments)
      .set({ status: 'rejected', endedAt: sql`now()` })
      .where(eq(containments.id, id));
    await this.record(id, 'rejected', actorId, note);

    return this.detail(id);
  }

  /**
   * Buys more time, within the ceiling and a limited number of times.
   *
   * Bounded on purpose: extending without limit is how a system arrives at a permanent block by
   * increments, each one individually reasonable.
   */
  async extend(
    id: string,
    actorId: string,
    minutes: number,
    note?: string,
  ): Promise<ContainmentDto> {
    const row = await this.require(id);
    if (row.status !== 'active')
      throw new BadRequestException('only an active action can be extended');
    if (row.expiresAt === null) throw new BadRequestException('this action does not expire');

    const { containment } = this.policy.policy;
    if (row.extensions >= containment.maxExtensions) {
      throw new BadRequestException(
        `this has already been extended ${row.extensions} time(s), which is the limit`,
      );
    }

    const total =
      (row.expiresAt.getTime() - (row.activatedAt ?? row.proposedAt).getTime()) / 60_000;
    if (total + minutes > containment.maxMinutes) {
      throw new BadRequestException(
        `that would run to ${Math.round(total + minutes)} minutes, past the ${containment.maxMinutes}-minute ceiling`,
      );
    }

    await this.handle.db
      .update(containments)
      .set({
        expiresAt: sql`${containments.expiresAt} + make_interval(mins => ${minutes})`,
        extensions: row.extensions + 1,
      })
      .where(eq(containments.id, id));
    await this.record(id, 'extended', actorId, note ?? `by ${minutes} minutes`);

    return this.detail(id);
  }

  async release(id: string, actorId: string, note?: string): Promise<ContainmentDto> {
    const row = await this.require(id);
    if (row.status !== 'active')
      throw new BadRequestException('only an active action can be released');

    await this.handle.db
      .update(containments)
      .set({ status: 'released', endedAt: sql`now()` })
      .where(eq(containments.id, id));
    await this.record(id, 'released', actorId, note);

    return this.detail(id);
  }

  /**
   * Expires everything past its time.
   *
   * Runs on a timer and needs nobody. The exit condition for this slice is that a containment
   * lifts on its own — an action that requires somebody to remember to undo it is one that will
   * still be in place next month.
   */
  async expireDue(): Promise<number> {
    const due = await this.handle.db
      .select({ id: containments.id })
      .from(containments)
      .where(and(eq(containments.status, 'active'), sql`${containments.expiresAt} <= now()`));

    for (const row of due) {
      await this.handle.db
        .update(containments)
        .set({ status: 'expired', endedAt: sql`now()` })
        .where(eq(containments.id, row.id));
      await this.record(row.id, 'expired', null, 'reached its expiry without intervention');
    }

    return due.length;
  }

  /** Whether this entity is currently contained — what the storefront would ask. */
  async isContained(entityKind: string, entityKey: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: containments.id })
      .from(containments)
      .where(
        and(
          eq(containments.entityKind, entityKind),
          eq(containments.entityKey, entityKey),
          eq(containments.status, 'active'),
          sql`${containments.action} = 'contain'`,
          sql`${containments.expiresAt} > now()`,
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /**
   * The active containment blocking any of these entities, or null.
   *
   * This is the method that makes `contain` mean something. The action describes itself as
   * "refuse further attempts from this entity", and until something asks this question at the
   * point an attempt is made, that description is a promise nothing keeps. The checkout asks it
   * before creating an order, which is where a merchant can actually refuse: containing a
   * session, a device or a network is the merchant declining to open new orders for it.
   *
   * One entity is contained by a block on any of its three keys — an attacker who rotates
   * sessions is still on the same network — so all three are checked together.
   */
  async blocking(
    candidates: readonly { kind: string; key: string }[],
  ): Promise<{ id: string; action: string; entityKind: string } | null> {
    if (candidates.length === 0) return null;

    const [row] = await this.handle.db
      .select({ id: containments.id, action: containments.action, kind: containments.entityKind })
      .from(containments)
      .where(
        and(
          eq(containments.status, 'active'),
          sql`${containments.action} = 'contain'`,
          sql`${containments.expiresAt} > now()`,
          or(
            ...candidates.map((candidate) =>
              and(
                eq(containments.entityKind, candidate.kind),
                eq(containments.entityKey, candidate.key),
              ),
            ),
          ),
        ),
      )
      .limit(1);

    return row === undefined ? null : { id: row.id, action: row.action, entityKind: row.kind };
  }

  async list(incidentId?: string): Promise<ContainmentDto[]> {
    const rows = await this.handle.db
      .select()
      .from(containments)
      .where(incidentId === undefined ? undefined : eq(containments.incidentId, incidentId))
      .orderBy(desc(containments.proposedAt))
      .limit(100);

    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async detail(id: string): Promise<ContainmentDto> {
    return this.toDto(await this.require(id));
  }

  private async require(id: string): Promise<Row> {
    const [row] = await this.handle.db
      .select()
      .from(containments)
      .where(eq(containments.id, id))
      .limit(1);
    if (row === undefined) throw new NotFoundException('no such action');
    return row;
  }

  private async approvers(id: string): Promise<string[]> {
    const rows = await this.handle.db
      .select({ actorId: containmentEvents.actorId })
      .from(containmentEvents)
      .where(and(eq(containmentEvents.containmentId, id), eq(containmentEvents.kind, 'approved')));

    return rows.map((row) => row.actorId).filter((id): id is string => id !== null);
  }

  private async record(
    containmentId: string,
    kind: string,
    actorId: string | null,
    note: string | null | undefined,
  ): Promise<void> {
    await this.handle.db.insert(containmentEvents).values({
      containmentId,
      kind,
      ...(actorId === null ? {} : { actorId }),
      ...(note === null || note === undefined ? {} : { note }),
    });
  }

  private async toDto(row: Row): Promise<ContainmentDto> {
    const history = await this.handle.db
      .select({
        kind: containmentEvents.kind,
        note: containmentEvents.note,
        at: containmentEvents.at,
        actor: users.displayName,
      })
      .from(containmentEvents)
      .leftJoin(users, eq(users.id, containmentEvents.actorId))
      .where(eq(containmentEvents.containmentId, row.id))
      .orderBy(containmentEvents.at);

    return {
      id: row.id,
      incidentId: row.incidentId,
      entityKind: row.entityKind as ContainmentDto['entityKind'],
      entityKey: row.entityKey,
      action: row.action as ContainmentDto['action'],
      status: row.status,
      approvalsRequired: row.approvalsRequired,
      approvals: history.filter((e) => e.kind === 'approved').map((e) => e.actor ?? 'unknown'),
      decision: row.decision as PolicyDecisionDto,
      policyVersion: row.policyVersion,
      policyHash: row.policyHash,
      proposedBy: history.find((e) => e.kind === 'proposed')?.actor ?? null,
      proposedAt: row.proposedAt.getTime(),
      activatedAt: row.activatedAt?.getTime() ?? null,
      expiresAt: row.expiresAt?.getTime() ?? null,
      endedAt: row.endedAt?.getTime() ?? null,
      extensions: row.extensions,
      history: history.map((entry) => ({
        kind: entry.kind,
        actor: entry.actor,
        note: entry.note,
        at: entry.at.getTime(),
      })),
    };
  }

  /** Exposed so the expiry job and tests can assert on what is customer-impacting. */
  static touchesCustomer(action: string): boolean {
    return isCustomerImpacting(action as Parameters<typeof isCustomerImpacting>[0]);
  }
}
