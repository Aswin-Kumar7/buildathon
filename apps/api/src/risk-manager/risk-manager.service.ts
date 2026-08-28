import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { CircuitBreaker, withTimeout } from '@sentinel/narrate';
import { type IncidentStatus } from '@sentinel/detect';
import {
  groundingHash,
  liveSelector,
  localSelector,
  replaySelector,
  riskFallbackChain,
  runRiskFallback,
  templateSelector,
  type RiskAssessment,
  type RiskFacts,
  type RiskMode,
  type RiskProvider,
  type RiskSelection,
  type RiskSelector,
} from '@sentinel/risk-manager';
import type {
  IncidentDetail,
  PolicyDecisionDto,
  RiskAcceptOutcome,
  RiskAcceptResponse,
  RiskRecommendation,
} from '@sentinel/contracts';
import { IncidentsService } from '../incidents/incidents.service.js';
import { ContainmentService } from '../containment/containment.service.js';
import { AuditService } from '../audit/audit.service.js';

/** Injection token for the optional live reasoner. Absent unless GROQ is configured. */
export const RISK_PROVIDER = Symbol('RISK_PROVIDER');

const MODES: readonly RiskMode[] = ['live', 'local', 'replay', 'template'];

/**
 * The AI Risk Manager in the request path: turn an incident's verified record and the policy
 * preview into an advisory recommendation, from the best tier that will answer, and never from
 * anything a model made up.
 *
 * It mirrors narration's machinery — a configured mode, a response cache that doubles as the replay
 * record, a circuit breaker in front of the live provider — and adds the half narration does not
 * have: accepting a recommendation dispatches it through the *existing* human-gated rails
 * (propose/approve, transition), and every acceptance is written to the tamper-evident audit chain
 * with the reasoning version and grounding hash as provenance. Nothing here is a new authority.
 */
@Injectable()
export class RiskManagerService {
  private readonly logger = new Logger(RiskManagerService.name);
  private readonly mode: RiskMode;

  private readonly cache = new Map<string, RiskAssessment>();
  private readonly record = new Map<string, RiskSelection>();

  private readonly breaker = new CircuitBreaker({
    failureThreshold: 3,
    cooldownMs: 10_000,
    now: () => Date.now(),
  });
  // Generous enough for a fast hosted model to answer (incl. the LLM writing the explanation
  // prose), still short enough that a stalled provider drops to the deterministic tier quickly.
  private readonly timeoutMs = 10_000;

  constructor(
    private readonly incidents: IncidentsService,
    private readonly containment: ContainmentService,
    private readonly audit: AuditService,
    @Optional() @Inject(RISK_PROVIDER) private readonly provider?: RiskProvider,
  ) {
    const configured = (process.env.RISK_MANAGER_MODE ?? 'local').toLowerCase();
    this.mode = (MODES as readonly string[]).includes(configured)
      ? (configured as RiskMode)
      : 'local';
    this.logger.log(
      `risk-manager mode=${this.mode} provider=${this.provider === undefined ? 'none' : 'configured'}`,
    );
  }

  /** The current recommendation for one incident, grounded in its verified record + policy preview. */
  async recommend(incidentId: string): Promise<RiskRecommendation> {
    const { assessment } = await this.assess(incidentId);
    return this.toDto(incidentId, assessment);
  }

  /** The read-only policy decision for an incident — what would be proposed, and what is held back. */
  async policyPreview(incidentId: string): Promise<PolicyDecisionDto | null> {
    return (await this.containment.preview(incidentId)) as PolicyDecisionDto | null;
  }

  private async assess(
    incidentId: string,
  ): Promise<{ detail: IncidentDetail; facts: RiskFacts; assessment: RiskAssessment }> {
    const detail = await this.incidents.detail(incidentId);
    const preview = await this.containment.preview(incidentId);
    const facts = RiskManagerService.factsFrom(detail, preview);
    const hash = groundingHash(facts);
    const cacheKey = `${this.mode}:${hash}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return { detail, facts, assessment: cached };

    const assessment = await runRiskFallback(facts, this.chainFor(), (a, selection) => {
      // A live selection is the one worth recording, so the network can be pulled later and the
      // same recommendation reproduced from replay rather than re-selected into something different.
      if (a.source === 'live') this.record.set(a.groundingHash, selection);
    });

    this.cache.set(cacheKey, assessment);
    if (assessment.dropped > 0) {
      this.logger.warn(`risk-manager dropped ${assessment.dropped} claim(s) for ${incidentId}`);
    }
    return { detail, facts, assessment };
  }

  private chainFor(): RiskSelector[] {
    const live = this.provider !== undefined ? this.guardedLive(this.provider) : undefined;
    return riskFallbackChain(this.mode, {
      ...(live !== undefined ? { live } : {}),
      replay: replaySelector({
        get: (h) => this.record.get(h),
        put: (h, s) => void this.record.set(h, s),
      }),
      local: localSelector,
      template: templateSelector,
    });
  }

  /** The live tier, behind the breaker and a hard timeout: a slow/broken provider drops to local. */
  private guardedLive(provider: RiskProvider): RiskSelector {
    const base = liveSelector(provider);
    return {
      source: 'live',
      select: async (facts, reasons, changes, hash) => {
        if (!this.breaker.canAttempt()) throw new Error('risk-manager breaker open');
        try {
          const result = await withTimeout(
            Promise.resolve(base.select(facts, reasons, changes, hash)),
            this.timeoutMs,
            () => {},
          );
          this.breaker.recordSuccess();
          this.logger.log('risk-manager live tier answered');
          return result;
        } catch (error) {
          this.breaker.recordFailure();
          const cause =
            error instanceof Error && error.cause instanceof Error
              ? ` | cause: ${(error.cause as { code?: string }).code ?? ''} ${error.cause.message}`
              : '';
          // Log why the live tier failed — the fallback is silent by design, but a provider that
          // never answers should not be invisible. The request still degrades to the local tier.
          this.logger.warn(
            `risk-manager live tier failed, falling back: ${error instanceof Error ? error.message : String(error)}${cause}`,
          );
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
    };
  }

  /**
   * Accept a recommendation: re-derive it server-side, refuse a stale snapshot, then dispatch it
   * through the existing rails. Contain is proposed (and still needs approval); review transitions
   * the incident; monitor changes nothing. Every acceptance is audited with provenance.
   */
  async accept(
    incidentId: string,
    actorId: string,
    clientHash: string,
    note?: string,
  ): Promise<RiskAcceptResponse> {
    const { detail, assessment } = await this.assess(incidentId);

    // Never trust the client's action: the recommendation is recomputed here, and a hash that no
    // longer matches means the incident moved since it was shown.
    if (clientHash !== assessment.groundingHash) {
      throw new ConflictException(
        'this incident changed since the recommendation was shown — refresh and try again',
      );
    }

    // A closed incident takes no new action. Its history is settled, and an action recorded against
    // it would claim something happened that the state machine will not allow.
    if (detail.status === 'resolved' || detail.status === 'expired') {
      throw new BadRequestException(
        `this incident is ${detail.status} and no longer accepts actions`,
      );
    }

    const downgraded = detail.recommendedDecision === 'contain' && assessment.action === 'review';

    // The acceptance is recorded first, before the action it authorises, so the chain reads
    // recommendation → action in the order they happened.
    await this.auditDecision(incidentId, actorId, 'recommendation.accepted', assessment, note);

    let outcome: RiskAcceptOutcome;
    let status: IncidentStatus | null = null;

    if (assessment.action === 'contain') {
      await this.proposeContainment(incidentId, actorId, note);
      outcome = 'containment_proposed';
    } else if (assessment.action === 'review') {
      // Non-terminal by the guard above: open/contained transition to review; already-under-review
      // is left where it is. Either way the incident ends up under review.
      if (detail.status !== 'under_review') {
        await this.incidents.transition(incidentId, 'under_review', actorId, note);
      }
      status = 'under_review';
      outcome = downgraded ? 'downgraded_to_review' : 'moved_to_review';
    } else {
      outcome = 'monitoring_recorded';
    }

    return { action: assessment.action, outcome, refusals: assessment.refusals, status };
  }

  /** Decline a recommendation. Recorded so a rejected recommendation is as traceable as an accepted one. */
  async reject(incidentId: string, actorId: string, note?: string): Promise<void> {
    const { assessment } = await this.assess(incidentId);
    await this.auditDecision(incidentId, actorId, 'recommendation.rejected', assessment, note);
  }

  private async proposeContainment(
    incidentId: string,
    actorId: string,
    note: string | undefined,
  ): Promise<void> {
    try {
      await this.containment.propose(incidentId, actorId, note);
    } catch (error) {
      // A live proposal already exists — the containment the AI would create is already on the
      // board awaiting approval, so this is a no-op, not a failure.
      if (error instanceof ConflictException) return;
      throw error;
    }
  }

  private async auditDecision(
    incidentId: string,
    actorId: string,
    kind: 'recommendation.accepted' | 'recommendation.rejected',
    assessment: RiskAssessment,
    note: string | undefined,
  ): Promise<void> {
    await this.audit.append({
      actorId,
      kind,
      subjectType: 'incident',
      subjectId: incidentId,
      payload: {
        action: assessment.action,
        source: assessment.source,
        alignment: assessment.alignment,
        rationaleClaimIds: assessment.rationaleClaimIds,
        whatWouldChangeIds: assessment.whatWouldChangeIds,
        refusals: assessment.refusals,
        reasoningVersion: assessment.reasoningVersion,
        groundingHash: assessment.groundingHash,
        note: note ?? null,
      },
      // Provenance: the reasoning layer version and a hash of the exact snapshot it consumed, both
      // hashed into the chain so the recommendation's inputs are tamper-evident.
      modelVersion: assessment.reasoningVersion,
      featureSnapshotHash: assessment.groundingHash,
    });
  }

  private toDto(incidentId: string, a: RiskAssessment): RiskRecommendation {
    return {
      incidentId,
      action: a.action,
      actionLabel: a.actionLabel,
      rationale: a.rationale,
      rationaleAuthored: a.rationaleAuthored,
      keyReasons: a.keyReasons,
      whatWouldChange: a.whatWouldChange,
      alignment: a.alignment,
      alignmentNote: a.alignmentNote,
      refusals: a.refusals,
      policyAction: a.policyAction,
      modelAvailable: a.modelAvailable,
      degraded: this.mode === 'live' && a.source !== 'live',
      rehearsal: a.rehearsal,
      source: a.source,
      reasoningVersion: a.reasoningVersion,
      groundingHash: a.groundingHash,
      rationaleClaimIds: a.rationaleClaimIds,
      whatWouldChangeIds: a.whatWouldChangeIds,
      dropped: a.dropped,
    };
  }

  /** The one place an incident's verified record and the policy preview become risk facts. */
  static factsFrom(detail: IncidentDetail, preview: PolicyDecisionDto | null): RiskFacts {
    return {
      entityKind: detail.entityKind,
      severity: detail.severity,
      score: detail.score,
      recommendedDecision: detail.recommendedDecision,
      attempts: detail.attempts,
      failures: detail.failures,
      distinctCards: detail.distinctCards,
      evidence: detail.evidence.map((e) => ({
        rule: e.rule,
        code: e.code,
        observed: e.observed,
        threshold: e.threshold,
        weight: e.weight,
      })),
      best: detail.arbitration?.best ?? null,
      runnerUp: detail.arbitration?.runnerUp ?? null,
      margin: detail.arbitration?.margin ?? null,
      modelInfluence: detail.arbitration?.modelInfluence ?? null,
      model:
        detail.modelOpinion === null
          ? null
          : {
              risk: detail.modelOpinion.risk,
              predictedClass: detail.modelOpinion.predictedClass,
              band: detail.modelOpinion.band,
              abstained: detail.modelOpinion.abstained,
            },
      modelAvailable: detail.modelAvailable,
      changeFired:
        detail.change === null
          ? null
          : { ewma: detail.change.ewma.fired, cusum: detail.change.cusum.fired },
      rehearsal: detail.source === 'replay',
      policy:
        preview === null
          ? { action: 'observe', approvalsRequired: 0, refusals: ['no_arbitration'] }
          : {
              action: preview.action,
              approvalsRequired: preview.approvalsRequired,
              refusals: preview.refusals,
            },
    };
  }
}
