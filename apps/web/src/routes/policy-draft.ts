/**
 * The editable shape of a policy, and the pure helpers that turn it into the exact YAML the
 * backend's own parser accepts. The console never decides policy behaviour — it only assembles a
 * candidate document and hands it to the same engine that governs live decisions, so every value
 * here maps one-to-one to a real field in `@sentinel/policy`.
 */

import type { PolicyResponse, PolicyWorkflowStatus } from '@sentinel/contracts';

/** Every field a merchant can change. Non-editable fields (costs, allowlist) are carried unchanged. */
export interface PolicyDraft {
  killSwitch: boolean;
  stepUp: number;
  contain: number;
  defaultMinutes: number;
  maxMinutes: number;
  maxExtensions: number;
  dualApprovalAbovePaise: number;
  containmentAlwaysNeedsApproval: boolean;
  maxActiveContainments: number;
  maxContainmentsPerHour: number;
  maxShareOfActiveSessions: number;
  shareAppliesAboveSessions: number;
  maxFeatureAgeMinutes: number;
  requireConfirmedCounts: boolean;
  refuseWhenArbitrationAbstained: boolean;
}

export function draftFromPolicy(policy: PolicyResponse): PolicyDraft {
  return {
    killSwitch: policy.killSwitch,
    stepUp: policy.thresholds.stepUp,
    contain: policy.thresholds.contain,
    defaultMinutes: policy.containment.defaultMinutes,
    maxMinutes: policy.containment.maxMinutes,
    maxExtensions: policy.containment.maxExtensions,
    dualApprovalAbovePaise: policy.approval.dualApprovalAbovePaise,
    containmentAlwaysNeedsApproval: policy.approval.containmentAlwaysNeedsApproval,
    maxActiveContainments: policy.impactCaps.maxActiveContainments,
    maxContainmentsPerHour: policy.impactCaps.maxContainmentsPerHour,
    maxShareOfActiveSessions: policy.impactCaps.maxShareOfActiveSessions,
    shareAppliesAboveSessions: policy.impactCaps.shareAppliesAboveSessions,
    maxFeatureAgeMinutes: policy.degradation.maxFeatureAgeMinutes,
    requireConfirmedCounts: policy.degradation.requireConfirmedCounts,
    refuseWhenArbitrationAbstained: policy.degradation.refuseWhenArbitrationAbstained,
  };
}

/** True when the draft differs from the active policy — the only time saving or previewing a change makes sense. */
export function isDirty(draft: PolicyDraft, policy: PolicyResponse): boolean {
  const base = draftFromPolicy(policy);
  return (Object.keys(draft) as (keyof PolicyDraft)[]).some((key) => draft[key] !== base[key]);
}

/** The next repository version the backend will accept for a new draft: one past the highest it knows. */
export function nextVersion(activeVersion: number, versionNumbers: number[]): number {
  return Math.max(activeVersion, ...versionNumbers, 0) + 1;
}

/** The cross-field rules the backend enforces, checked early so a merchant is guided before the round-trip. */
export function draftProblems(draft: PolicyDraft): string[] {
  const problems: string[] = [];
  if (draft.contain < draft.stepUp) {
    problems.push(
      'Block level must be at least the verification level — blocking is a bigger step than verifying.',
    );
  }
  if (draft.maxMinutes < draft.defaultMinutes) {
    problems.push('The longest a block can last must be at least the default block duration.');
  }
  return problems;
}

/**
 * Assembles a complete, valid policy document from the draft.
 *
 * Non-editable fields are copied from the active policy verbatim so nothing is silently dropped:
 * costs carry through, and the allowlist is emptied only because it is already empty (the caller
 * refuses to build a draft when entries exist, since the API returns counts, never the entries).
 */
export function buildPolicyYaml(
  draft: PolicyDraft,
  policy: PolicyResponse,
  version: number,
): string {
  return `version: ${version}
killSwitch: ${draft.killSwitch}
thresholds:
  stepUp: ${draft.stepUp}
  contain: ${draft.contain}
containment:
  defaultMinutes: ${draft.defaultMinutes}
  maxMinutes: ${draft.maxMinutes}
  maxExtensions: ${draft.maxExtensions}
approval:
  dualApprovalAbovePaise: ${draft.dualApprovalAbovePaise}
  containmentAlwaysNeedsApproval: ${draft.containmentAlwaysNeedsApproval}
impactCaps:
  maxActiveContainments: ${draft.maxActiveContainments}
  maxContainmentsPerHour: ${draft.maxContainmentsPerHour}
  maxShareOfActiveSessions: ${draft.maxShareOfActiveSessions}
  shareAppliesAboveSessions: ${draft.shareAppliesAboveSessions}
allowlist:
  sessions: []
  devices: []
  networks: []
degradation:
  maxFeatureAgeMinutes: ${draft.maxFeatureAgeMinutes}
  requireConfirmedCounts: ${draft.requireConfirmedCounts}
  refuseWhenArbitrationAbstained: ${draft.refuseWhenArbitrationAbstained}
costs:
  chargebackPaise: ${policy.costs.chargebackPaise}
  blockedShopperPaise: ${policy.costs.blockedShopperPaise}
  reviewPaise: ${policy.costs.reviewPaise}
`;
}

// The risk score is a continuous 0–1 value in the engine; these ladders are convenient, valid
// choices, never a fixed backend tier system. The active policy's own value is always merged in so
// nothing off the ladder is ever hidden, and each option is shown as the honest percentage.
const VERIFY_LADDER = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
const BLOCK_LADDER = [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
const DURATION_LADDER = [5, 10, 15, 30, 45, 60, 90, 120];

export const scoreOptions = (current: number, floor: number): number[] =>
  [...new Set([...VERIFY_LADDER, current])]
    .filter((s) => s >= floor && s <= 1)
    .sort((a, b) => a - b);

export const blockOptions = (current: number, floor: number): number[] =>
  [...new Set([...BLOCK_LADDER, current])]
    .filter((s) => s >= floor && s <= 1)
    .sort((a, b) => a - b);

export const durationOptions = (current: number, max: number): number[] =>
  [...new Set([...DURATION_LADDER, current])]
    .filter((d) => d >= 1 && d <= max)
    .sort((a, b) => a - b);

export const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** The real lifecycle statuses, in readable form — the raw status is always what is kept internally. */
export const STATUS_LABEL: Record<PolicyWorkflowStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
};

export const STATUS_TONE: Record<
  PolicyWorkflowStatus,
  'info' | 'warn' | 'ok' | 'critical' | 'neutral'
> = {
  draft: 'neutral',
  pending_approval: 'warn',
  approved: 'info',
  published: 'ok',
  rejected: 'critical',
};
