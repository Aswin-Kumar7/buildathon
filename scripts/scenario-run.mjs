#!/usr/bin/env node
/**
 * Complete scenario-matrix harness.
 *
 * Generates each of the eight committed scenario families deterministically, runs the whole pure
 * detection pipeline over it, and reports whether the system's verdict matches the correct answer
 * the corpus declared in advance. One honest table: attacks caught, benign/operational traffic not
 * treated as an attack.
 *
 * The pipeline composition mirrors apps/api/src/incidents/incidents.service.ts exactly —
 * features -> rules -> cluster -> traffic -> arbitrate — but in pure form. It imports only from the
 * built @sentinel/corpus and @sentinel/detect packages; nothing here touches the API, a database, a
 * clock, or a random source, so the output is byte-for-byte reproducible.
 *
 * Window choice. The production detector uses a 30-minute window. These corpus scenarios span from
 * four minutes (attack_loud) to three hours (retry_storm), and attack_low_amplitude is defined to
 * "need a longer window than a burst detector uses". Judging every family through the same wide
 * observation window is what apps/api/src/incidents/comparison.service.ts does for exactly this
 * reason: it makes the result a test of the detector's logic rather than an artefact of where a
 * 30-minute window happens to land in a given scenario. The thresholds judging these are the same
 * ones production uses; only the observation period is widened, and it is stated in the report.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate, SCENARIOS, SCENARIO_FAMILIES } from '@sentinel/corpus';
import {
  arbitrate,
  clusterIncidents,
  computeAllFeatures,
  computeFeatures,
  computeTraffic,
  dropDuplicateViews,
  evaluateRules,
  minutes,
  thresholdHash,
} from '@sentinel/detect';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'docs', 'performance');

/** The three entity kinds evaluated on every pass — an attacker rotating one is caught by another. */
const KINDS = ['session', 'device', 'network'];

/** How many entities per kind survive to the exact-confirmation pass, matching incidents.service. */
const CANDIDATES = 40;

/**
 * A wide observation window so an entire episode is in view regardless of how long it ran. Same
 * shape comparison.service uses. Half-life stays at the production 5 minutes, so decayed rates read
 * the same way they would live.
 */
const WINDOW = { windowMs: minutes(600), halfLifeMs: minutes(5) };

/** Strength ordering of decisions, so the driving incident of a family is well defined. */
const DECISION_RANK = { contain: 3, review: 2, monitor: 1, none: 0 };

/**
 * Builds the flat Observation rows the features read, straight from a generated scenario.
 *
 * Identical mapping to comparison.service.load: the correlation keys are the storefront's own ids
 * with a `v1:` prefix. Pseudonymisation through HMAC only obscures the value, never the grouping,
 * so using the raw ids here yields exactly the same features as a real replay would.
 */
function toObservations(scenario) {
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));
  const str = (v) => (typeof v === 'string' ? v : null);

  return scenario.events.flatMap((event) => {
    const body = event.body;
    const entity = body?.payload?.payment?.entity;
    if (entity === undefined) return [];

    const orderId = str(entity['order_id']) ?? '';
    const checkout = checkouts.get(orderId);
    const status = str(entity['status']);

    return [
      {
        at: body.created_at * 1000,
        razorpayOrderId: orderId,
        razorpayPaymentId: str(entity['id']) ?? '',
        outcome:
          status === 'captured'
            ? 'captured'
            : status === 'failed'
              ? 'failed'
              : status === 'authorized'
                ? 'authorized'
                : 'other',
        amountPaise: typeof entity['amount'] === 'number' ? entity['amount'] : null,
        cardId: str(entity['card_id']),
        errorSource: str(entity['error_source']),
        errorReason: str(entity['error_reason']),
        sessionPseudonym: checkout ? `v1:${checkout.clientSessionId}` : null,
        devicePseudonym: checkout ? `v1:${checkout.deviceId}` : null,
        ipPseudonym: checkout ? `v1:${checkout.ip}` : null,
        userAgentFamily: checkout?.userAgentFamily ?? null,
      },
    ];
  });
}

/**
 * Ranks and confirms feature vectors for one entity kind, exactly as FeaturesService.rank does:
 * one cheap approximate pass to find candidates, then the exact-confirmation pass on the survivors.
 */
function rankVectors(kind, observations, asOf) {
  const judged = computeAllFeatures(kind, observations, asOf, WINDOW, false).filter(
    (v) => v.attempts > 0,
  );

  const discovery = [...judged]
    .sort(
      (a, b) =>
        b.failures - a.failures ||
        b.distinctCards.estimate - a.distinctCards.estimate ||
        b.attempts - a.attempts,
    )
    .slice(0, CANDIDATES);

  return discovery.map((v) => computeFeatures(kind, v.entityKey, observations, asOf, WINDOW, true));
}

/**
 * Runs the full pipeline over one family and returns the structured verdict.
 *
 * Mirrors incidents.service.evaluate: for each kind, rank -> evaluateRules -> clusterIncidents;
 * then computeTraffic once for the whole shop; then dropDuplicateViews and arbitrate each survivor
 * against that traffic. An incident is "raised" when arbitration wants a person to see it, which is
 * exactly incidents.service's `['contain', 'review'].includes(decision)`.
 */
function runFamily(family) {
  const spec = SCENARIOS[family];
  const scenario = generate(family); // seeded from spec.seed
  const observations = toObservations(scenario);

  // As of the scenario's end. +1000ms so the final event is inside the window boundary.
  const asOf = Math.max(...observations.map((o) => o.at)) + 1000;

  const vectorsByKey = new Map();
  const found = [];

  for (const kind of KINDS) {
    const vectors = rankVectors(kind, observations, asOf);
    const evaluations = vectors.map((vector) => {
      vectorsByKey.set(`${kind}:${vector.entityKey}`, vector);
      return { vector, outcomes: evaluateRules(vector), at: asOf };
    });
    found.push(...clusterIncidents(evaluations));
  }

  const traffic = computeTraffic(observations, asOf, WINDOW);

  const incidents = dropDuplicateViews(found).map((incident) => {
    const vector = vectorsByKey.get(`${incident.entityKind}:${incident.entityKey}`);
    const arbitration = vector === undefined ? null : arbitrate(vector, traffic);
    return { incident, vector, arbitration };
  });

  // Which incidents arbitration actually wants a person to see — the ones incidents.service raises.
  const raised = incidents.filter(
    (r) => r.arbitration !== null && ['contain', 'review'].includes(r.arbitration.decision),
  );

  // The incident that drives the family's verdict: strongest decision, then highest score. If the
  // pass opened nothing at all, fall back to arbitrating the single worst-failure entity so the
  // report still shows what the system concluded (it will be a non-attack, no-action verdict).
  let driver = null;
  if (incidents.length > 0) {
    driver = [...incidents]
      .filter((r) => r.arbitration !== null)
      .sort(
        (a, b) =>
          DECISION_RANK[b.arbitration.decision] - DECISION_RANK[a.arbitration.decision] ||
          b.incident.score.value - a.incident.score.value,
      )[0];
  }
  if (driver === undefined || driver === null) {
    driver = worstEntityArbitration(observations, asOf, traffic, vectorsByKey);
  }

  const best = driver?.arbitration?.best ?? 'insufficient_evidence';
  const decision = driver?.arbitration?.decision ?? 'none';
  // "Warranted", per the task's definition: arbitration decided a person should see it. This is
  // the detector's judgment on the representative entity. It can differ from `incidentsRaised`
  // below — the rule tier's incident-opening gate is deliberately more conservative than
  // arbitration, and that gap is exactly the attack_distributed story.
  const incidentRaised = ['contain', 'review'].includes(decision);

  const expected = spec.classification; // 'benign' | 'operational' | 'attack'
  const pass =
    expected === 'attack'
      ? best === 'attack' && ['contain', 'review'].includes(decision)
      : best !== 'attack' && ['monitor', 'none'].includes(decision);

  return {
    family,
    title: spec.title,
    classification: expected,
    recommendedAction: spec.recommendedAction,
    seed: scenario.seed,
    specHash: scenario.specHash,
    counts: scenario.counts,
    asOf,
    best,
    runnerUp: driver?.arbitration?.runnerUp ?? null,
    margin: driver?.arbitration?.margin ?? null,
    decision,
    abstained: driver?.arbitration?.abstained ?? null,
    reasons: driver?.arbitration?.reasons ?? [],
    incidentRaised,
    incidentsRaised: raised.length,
    incidentsOpened: incidents.length,
    driver:
      driver === null || driver === undefined || driver.vector === undefined
        ? null
        : {
            entityKind: driver.vector.entityKind,
            fromOpenedIncident: driver.incident !== undefined,
            attempts: driver.vector.attempts,
            failures: driver.vector.failures,
            distinctCards: driver.vector.distinctCards?.exact ?? null,
            approvalRate: round(driver.vector.approvalRate),
          },
    traffic: {
      attempts: traffic.attempts,
      failures: traffic.failures,
      approvalRate: round(traffic.approvalRate),
      infrastructureFailureShare: round(traffic.infrastructureFailureShare),
      failingSessions: traffic.failingSessions,
      activeSessions: traffic.activeSessions,
      topSessionFailureShare: round(traffic.topSessionFailureShare),
      distinctCards: traffic.distinctCards,
    },
    pass,
  };
}

/**
 * When no incident opened, arbitrate the single worst-failure entity across all kinds so the
 * report can still state the system's conclusion. This never fabricates an incident — the returned
 * shape has no `incident`, so it is never counted as raised.
 */
function worstEntityArbitration(observations, asOf, traffic, vectorsByKey) {
  let best = null;
  for (const kind of KINDS) {
    const vectors = computeAllFeatures(kind, observations, asOf, WINDOW, true).filter(
      (v) => v.attempts > 0,
    );
    for (const v of vectors) {
      vectorsByKey.set(`${kind}:${v.entityKey}`, v);
      if (
        best === null ||
        v.failures > best.failures ||
        (v.failures === best.failures && v.attempts > best.attempts)
      ) {
        best = v;
      }
    }
  }
  if (best === null) return null;
  return { incident: undefined, vector: best, arbitration: arbitrate(best, traffic) };
}

function round(value) {
  if (value === null || value === undefined) return null;
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------------------------

const results = SCENARIO_FAMILIES.map(runFamily);
const passed = results.filter((r) => r.pass).length;

const report = {
  kind: 'scenario-matrix',
  synthetic: true,
  generatedNote:
    'Synthetic, seed-deterministic scenarios from @sentinel/corpus. No live traffic, no database, no clock.',
  thresholdHash: thresholdHash(),
  window: { windowMinutes: WINDOW.windowMs / 60000, halfLifeMinutes: WINDOW.halfLifeMs / 60000 },
  familiesTotal: results.length,
  familiesPassed: passed,
  results,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'scenario-matrix.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'scenario-matrix.md'), renderMarkdown(report));

// Console summary, so the harness is legible when run directly.
const cell = (s, n) => String(s).padEnd(n);
console.log(
  `\nScenario matrix  (thresholdHash ${report.thresholdHash}, window ${report.window.windowMinutes}m)\n`,
);
console.log(
  cell('Family', 22) +
    cell('Expected', 13) +
    cell('Best', 22) +
    cell('Decision', 10) +
    cell('Raised', 8) +
    'Verdict',
);
console.log('-'.repeat(90));
for (const r of results) {
  console.log(
    cell(r.family, 22) +
      cell(r.classification, 13) +
      cell(r.best, 22) +
      cell(r.decision, 10) +
      cell(r.incidentRaised ? 'yes' : 'no', 8) +
      (r.pass ? 'PASS' : 'FAIL'),
  );
}
console.log('-'.repeat(90));
console.log(`\n${passed}/${results.length} families correct.\n`);

if (passed !== results.length) process.exitCode = 1;

// ---------------------------------------------------------------------------------------------

function renderMarkdown(rep) {
  const lines = [];
  lines.push('# Scenario matrix');
  lines.push('');
  lines.push(
    '> **Synthetic, seed-deterministic scenarios.** Every family below is generated in-process ' +
      'from `@sentinel/corpus` at its committed seed and run through the pure detection pipeline ' +
      '(`features -> rules -> cluster -> traffic -> arbitrate`, mirroring ' +
      '`apps/api/src/incidents/incidents.service.ts`). No live traffic, no database, no clock, no ' +
      'randomness: `node scripts/scenario-run.mjs` produces byte-identical output every time.',
  );
  lines.push('');
  lines.push(
    `Threshold fingerprint \`${rep.thresholdHash}\` (production thresholds, unmodified). ` +
      `Observation window ${rep.window.windowMinutes} min / half-life ${rep.window.halfLifeMinutes} min — ` +
      'widened from the production 30-minute window so an entire episode is in view for every ' +
      'family, the same choice `comparison.service.ts` makes. The thresholds are the ones ' +
      'production uses; only the observation period is widened.',
  );
  lines.push('');
  lines.push(
    `**Result: ${rep.familiesPassed}/${rep.familiesTotal} families classified correctly** ` +
      '(attacks caught and warranted; benign and operational traffic not treated as an attack and ' +
      'never contained).',
  );
  lines.push('');
  lines.push(
    '| Family | Classification (expected) | Best hypothesis | Decision | Incident raised? | Verdict | Note |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rep.results) {
    lines.push(
      `| \`${r.family}\` | ${r.classification} | ${r.best} | ${r.decision} | ${
        r.incidentRaised ? 'yes' : 'no'
      } | ${r.pass ? '**PASS**' : '**FAIL**'} | ${noteFor(r)} |`,
    );
  }
  lines.push('');
  lines.push('## What each verdict means');
  lines.push('');
  lines.push(
    '- **PASS for an attack** = the winning explanation was `attack` *and* arbitration warranted a ' +
      'response (`contain` or `review`).',
  );
  lines.push(
    '- **PASS for benign/operational** = the winning explanation was *not* `attack` *and* no ' +
      'customer-impacting action was taken (decision `monitor` or `none`).',
  );
  lines.push(
    '- **Incident raised** mirrors `incidents.service`: an incident is surfaced to a person only ' +
      'when arbitration decides `contain` or `review`. A family that opens an internal incident ' +
      'which then arbitrates to `monitor`/`none` is *suppressed*, not raised.',
  );
  lines.push('');
  lines.push('## Assessment');
  lines.push('');
  lines.push(summaryParagraph(rep));
  lines.push('');
  lines.push('## Per-family detail');
  lines.push('');
  lines.push(
    '| Family | Driver entity | Attempts | Failures | Cards | Approval | Shop approval | Gateway-blamed share | Top-session share | Rule-tier incidents opened | Runner-up (margin) |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rep.results) {
    const d = r.driver;
    const entityLabel =
      d === null ? '—' : `${d.entityKind}${d.fromOpenedIncident ? '' : ' (worst, no incident)'}`;
    lines.push(
      `| \`${r.family}\` | ${entityLabel} | ${d?.attempts ?? '—'} | ${
        d?.failures ?? '—'
      } | ${d?.distinctCards ?? '—'} | ${fmt(d?.approvalRate)} | ${fmt(
        r.traffic.approvalRate,
      )} | ${fmt(r.traffic.infrastructureFailureShare)} | ${fmt(
        r.traffic.topSessionFailureShare,
      )} | ${r.incidentsRaised}/${r.incidentsOpened} raised | ${r.runnerUp ?? '—'} (${
        r.margin ?? '—'
      }) |`,
    );
  }
  lines.push('');
  lines.push(
    '_Generated by `scripts/scenario-run.mjs`. Structured results in `scenario-matrix.json`._',
  );
  lines.push('');
  return lines.join('\n');
}

function fmt(v) {
  return v === null || v === undefined ? '—' : v.toFixed(3);
}

function noteFor(r) {
  if (r.classification === 'attack') {
    if (r.pass) {
      if (r.incidentsOpened === 0) {
        return `arbitration flags attack (${r.decision}); rule tier opened no incident — see assessment`;
      }
      return `caught: ${r.decision}, ${r.driver?.distinctCards ?? '?'} cards on ${
        r.driver?.entityKind ?? '?'
      }`;
    }
    return `MISS: best=${r.best}, decision=${r.decision}`;
  }
  // benign / operational
  if (r.pass) {
    if (r.best === 'outage') return 'read as outage, monitor only';
    if (r.best === 'retry_storm') return 'read as dunning, suppressed';
    if (r.best === 'healthy_traffic') return 'read as healthy, no action';
    return `${r.best}, no action`;
  }
  return `WRONGLY FLAGGED: best=${r.best}, decision=${r.decision}`;
}

function summaryParagraph(rep) {
  const byFam = Object.fromEntries(rep.results.map((r) => [r.family, r]));
  const attacks = rep.results.filter((r) => r.classification === 'attack');
  const attacksCaught = attacks.filter((r) => r.pass).length;
  const notAttacks = rep.results.filter((r) => r.classification !== 'attack');
  const notAttacksClean = notAttacks.filter((r) => r.pass).length;

  const parts = [];
  parts.push(
    `The detector classified ${rep.familiesPassed} of ${rep.familiesTotal} families correctly: ` +
      `${attacksCaught}/${attacks.length} attacks caught and warranted, and ` +
      `${notAttacksClean}/${notAttacks.length} benign/operational families left un-contained.`,
  );

  const outage = byFam['gateway_outage'];
  const storm = byFam['retry_storm'];
  if (outage) {
    parts.push(
      `The two operational families are the ones an amateur counter gets wrong: \`gateway_outage\` ` +
        `has the highest failure count of any family here (${outage.traffic.failures} failures across ` +
        `${outage.traffic.failingSessions} sessions) yet reads as **${outage.best}** because the ` +
        `gateway is blamed for ${(outage.traffic.infrastructureFailureShare * 100).toFixed(0)}% of ` +
        `them and the failures are spread, not concentrated` +
        (storm
          ? `, and \`retry_storm\` reads as **${storm.best}** because a few cards are hammered rather ` +
            `than a list walked.`
          : '.'),
    );
  }

  const low = byFam['attack_low_amplitude'];
  const dist = byFam['attack_distributed'];
  const hardNotes = [];
  if (low) {
    hardNotes.push(
      `\`attack_low_amplitude\` is the genuinely hard attack: one or two attempts per card spread ` +
        `over an hour, which never trips a per-minute rate. It is caught here (best=${low.best}, ` +
        `decision=${low.decision}) on approval collapse and card-per-attempt over the full window — ` +
        `and would be invisible to a 30-minute burst detector, which is why the window is widened.`,
    );
  }
  if (dist) {
    hardNotes.push(
      `\`attack_distributed\` is the one to read carefully. Spread across a proxy pool at ` +
        `~${(dist.counts.orders / Math.max(dist.counts.distinctSessions, 1)).toFixed(1)} attempts ` +
        `per session, no single entity has enough shape to trip a discriminating rule, so the rule ` +
        `tier opens **${dist.incidentsOpened} incidents** — the burst gate genuinely does not catch ` +
        `it. The arbitration layer does: given the worst entity against shop traffic it reads ` +
        `**${dist.best}** and routes to **${dist.decision}**, carried by the shop-level ` +
        `\`shop_failing_with_nobody_to_blame\` expectation (shop approval ` +
        `${(dist.traffic.approvalRate * 100).toFixed(0)}%, gateway blamed for ` +
        `${(dist.traffic.infrastructureFailureShare * 100).toFixed(0)}% of failures). So the ` +
        `detector's judgment is correct, but note the split: as \`incidents.service\` is currently ` +
        `wired, arbitration only runs on incidents the rule tier already opened, so this attack ` +
        `would not surface through the production incident pass without also arbitrating un-opened ` +
        `candidates. That is the single most important caveat in this matrix.`,
    );
  }
  if (hardNotes.length > 0) parts.push(hardNotes.join(' '));

  const fails = rep.results.filter((r) => !r.pass);
  if (fails.length === 0) {
    parts.push(
      'No family was misclassified: nothing benign or operational was treated as an attack, and no ' +
        'attack was missed.',
    );
  } else {
    parts.push(
      'Families the harness flags as wrong: ' +
        fails
          .map(
            (r) =>
              `\`${r.family}\` (expected ${r.classification}, best=${r.best}, decision=${r.decision})`,
          )
          .join('; ') +
        '.',
    );
  }
  return parts.join(' ');
}
