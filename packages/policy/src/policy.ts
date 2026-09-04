/**
 * The policy: what the system is allowed to do, parsed from a file rather than compiled in.
 *
 * Kept out of code deliberately. A threshold in a function is a decision nobody reviews; a
 * threshold in a versioned file is a diff somebody has to approve. Every decision the system
 * makes records the version *and* a hash of the file that produced it, so the question "why did
 * it do that six weeks ago" has an answer that does not depend on what the file says today.
 *
 * Parsing is strict and unforgiving. A policy with a typo in it is not a policy with a sensible
 * default — it is a policy nobody has read, and this refuses to run on one.
 */

import { parse } from 'yaml';
import { fnv1aHex } from '@sentinel/detect';

export interface Thresholds {
  stepUp: number;
  contain: number;
}

export interface ContainmentPolicy {
  defaultMinutes: number;
  maxMinutes: number;
  maxExtensions: number;
}

export interface ApprovalPolicy {
  dualApprovalAbovePaise: number;
  containmentAlwaysNeedsApproval: boolean;
}

export interface ImpactCaps {
  maxActiveContainments: number;
  maxContainmentsPerHour: number;
  maxShareOfActiveSessions: number;
  /** Below this many active sessions, the share cap does not apply. */
  shareAppliesAboveSessions: number;
}

export interface Allowlist {
  sessions: string[];
  devices: string[];
  networks: string[];
}

export interface DegradationPolicy {
  maxFeatureAgeMinutes: number;
  requireConfirmedCounts: boolean;
  refuseWhenArbitrationAbstained: boolean;
}

export interface Costs {
  chargebackPaise: number;
  blockedShopperPaise: number;
  reviewPaise: number;
}

export interface Policy {
  version: number;
  killSwitch: boolean;
  thresholds: Thresholds;
  containment: ContainmentPolicy;
  approval: ApprovalPolicy;
  impactCaps: ImpactCaps;
  allowlist: Allowlist;
  degradation: DegradationPolicy;
  costs: Costs;
}

export class InvalidPolicy extends Error {
  constructor(readonly problems: string[]) {
    super(`policy is not usable:\n  ${problems.join('\n  ')}`);
    this.name = 'InvalidPolicy';
  }
}

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Collects every problem before failing, so a broken file is fixed in one pass rather than six. */
class Reader {
  readonly problems: string[] = [];

  constructor(private readonly raw: Raw) {}

  private at(path: string): unknown {
    let current: unknown = this.raw;
    for (const part of path.split('.')) {
      if (!isObject(current)) return undefined;
      current = current[part];
    }
    return current;
  }

  number(path: string, { min, max }: { min?: number; max?: number } = {}): number {
    const value = this.at(path);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.problems.push(`${path} must be a number`);
      return 0;
    }
    if (min !== undefined && value < min) this.problems.push(`${path} must be at least ${min}`);
    if (max !== undefined && value > max) this.problems.push(`${path} must be at most ${max}`);
    return value;
  }

  boolean(path: string): boolean {
    const value = this.at(path);
    if (typeof value !== 'boolean') {
      this.problems.push(`${path} must be true or false`);
      return false;
    }
    return value;
  }

  strings(path: string): string[] {
    const value = this.at(path);
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      this.problems.push(`${path} must be a list of strings`);
      return [];
    }
    return value as string[];
  }
}

/**
 * Parses and validates a policy document.
 *
 * Refuses rather than repairs. A missing threshold is not zero and an unparseable one is not a
 * default: both mean the file in front of us is not the policy anybody intended, and guessing
 * would produce a system whose behaviour nobody can predict from reading it.
 */
export function parsePolicy(source: string): Policy {
  let document: unknown;
  try {
    document = parse(source);
  } catch (error) {
    throw new InvalidPolicy([`could not be parsed as YAML: ${(error as Error).message}`]);
  }

  if (!isObject(document)) throw new InvalidPolicy(['must be a mapping at the top level']);

  const read = new Reader(document);
  const policy: Policy = {
    version: read.number('version', { min: 1 }),
    killSwitch: read.boolean('killSwitch'),
    thresholds: {
      stepUp: read.number('thresholds.stepUp', { min: 0, max: 1 }),
      contain: read.number('thresholds.contain', { min: 0, max: 1 }),
    },
    containment: {
      defaultMinutes: read.number('containment.defaultMinutes', { min: 1 }),
      maxMinutes: read.number('containment.maxMinutes', { min: 1 }),
      maxExtensions: read.number('containment.maxExtensions', { min: 0 }),
    },
    approval: {
      dualApprovalAbovePaise: read.number('approval.dualApprovalAbovePaise', { min: 0 }),
      containmentAlwaysNeedsApproval: read.boolean('approval.containmentAlwaysNeedsApproval'),
    },
    impactCaps: {
      maxActiveContainments: read.number('impactCaps.maxActiveContainments', { min: 0 }),
      maxContainmentsPerHour: read.number('impactCaps.maxContainmentsPerHour', { min: 0 }),
      maxShareOfActiveSessions: read.number('impactCaps.maxShareOfActiveSessions', {
        min: 0,
        max: 1,
      }),
      shareAppliesAboveSessions: read.number('impactCaps.shareAppliesAboveSessions', { min: 0 }),
    },
    allowlist: {
      sessions: read.strings('allowlist.sessions'),
      devices: read.strings('allowlist.devices'),
      networks: read.strings('allowlist.networks'),
    },
    degradation: {
      maxFeatureAgeMinutes: read.number('degradation.maxFeatureAgeMinutes', { min: 0 }),
      requireConfirmedCounts: read.boolean('degradation.requireConfirmedCounts'),
      refuseWhenArbitrationAbstained: read.boolean('degradation.refuseWhenArbitrationAbstained'),
    },
    costs: {
      chargebackPaise: read.number('costs.chargebackPaise', { min: 0 }),
      blockedShopperPaise: read.number('costs.blockedShopperPaise', { min: 0 }),
      reviewPaise: read.number('costs.reviewPaise', { min: 0 }),
    },
  };

  // Relationships between fields, which no per-field check can see.
  if (policy.thresholds.contain < policy.thresholds.stepUp) {
    read.problems.push(
      'thresholds.contain must be at least thresholds.stepUp — refusing a payment is a bigger ' +
        'act than asking for another factor, so it cannot need less evidence',
    );
  }
  if (policy.containment.maxMinutes < policy.containment.defaultMinutes) {
    read.problems.push('containment.maxMinutes must be at least containment.defaultMinutes');
  }

  if (read.problems.length > 0) throw new InvalidPolicy(read.problems);
  return policy;
}

/**
 * A fingerprint of the policy as parsed, not of the file as written.
 *
 * Comments and formatting are not policy, so reflowing the file must not change the hash — and
 * an actual change of any value must. Same construction as the corpus spec hashes and the
 * detector's threshold hash, for the same reason.
 */
export function policyHash(policy: Policy): string {
  // Built from the flattened key/value pairs, sorted. The obvious spelling —
  // `JSON.stringify(policy, sortedKeys)` — is wrong in a way that looks right: an array replacer
  // is a key *filter*, and dotted paths match none of the actual keys, so it hashed an almost
  // empty object. Every decision then recorded a fingerprint that did not depend on the policy
  // at all, which is worse than recording nothing.
  const flat = flatten(policy);
  const canonical = Object.keys(flat)
    .sort()
    .map((key) => `${key}=${JSON.stringify(flat[key])}`)
    .join(';');

  return fnv1aHex(canonical);
}

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (!isObject(value)) return { [prefix]: value };

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    Object.assign(out, flatten(nested, prefix === '' ? key : `${prefix}.${key}`));
  }
  return out;
}
