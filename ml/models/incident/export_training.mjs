// Emits the incident-classifier training table from the scenario corpus.
//
// Features are computed here, once, by the same @sentinel/detect functions the API uses at scoring
// time — so the model trains on exactly the numbers it will later be asked to score. Deterministic:
// the corpus is seeded, and this walks a fixed range of seeds, so training.csv is reproducible and
// its hash is what the model registry pins.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generate } from '@sentinel/corpus';
import {
  computeFeatures,
  computeTraffic,
  incidentFeatures,
  INCIDENT_FEATURE_NAMES,
  minutes,
} from '@sentinel/detect';

const HERE = dirname(fileURLToPath(import.meta.url));
const WINDOW = { windowMs: minutes(600), halfLifeMs: minutes(5) };
const SEEDS = 30;

// The scenario family maps to the class the model learns: four decidable classes. The explicit
// abstain is the model's reject option at scoring time, not a fifth label — an entity is always
// labelled by what it truly is, and the model earns the right to say "not sure" through confidence.
const FAMILY_CLASS = {
  attack_loud: 'attack',
  attack_distributed: 'attack',
  attack_low_amplitude: 'attack',
  gateway_outage: 'outage',
  retry_storm: 'retry_storm',
  normal_traffic: 'healthy_traffic',
  flash_sale: 'healthy_traffic',
  customer_error: 'healthy_traffic',
};

// The feature definition and its builder are shared with the API via @sentinel/detect, so the
// model trains on exactly the numbers the request path will later score.
const FEATURES = [...INCIDENT_FEATURE_NAMES];

function observationsFrom(scenario) {
  const checkouts = new Map(scenario.checkouts.map((c) => [c.razorpayOrderId, c]));
  return scenario.events.flatMap((event) => {
    const entity = event.body?.payload?.payment?.entity;
    if (entity === undefined) return [];
    const checkout = checkouts.get(entity.order_id);
    const status = String(entity.status ?? '');
    return [
      {
        at: event.body.created_at * 1000,
        razorpayOrderId: String(entity.order_id ?? ''),
        razorpayPaymentId: String(entity.id ?? ''),
        outcome:
          status === 'captured'
            ? 'captured'
            : status === 'failed'
              ? 'failed'
              : status === 'authorized'
                ? 'authorized'
                : 'other',
        amountPaise: typeof entity.amount === 'number' ? entity.amount : null,
        cardId: typeof entity.card_id === 'string' ? entity.card_id : null,
        errorSource: typeof entity.error_source === 'string' ? entity.error_source : null,
        errorReason: typeof entity.error_reason === 'string' ? entity.error_reason : null,
        sessionPseudonym: checkout ? `v1:${checkout.clientSessionId}` : null,
        devicePseudonym: checkout ? `v1:${checkout.deviceId}` : null,
        ipPseudonym: checkout ? `v1:${checkout.ip}` : null,
        userAgentFamily: checkout?.userAgentFamily ?? null,
      },
    ];
  });
}

function featureRow(vector, traffic) {
  const values = incidentFeatures(vector, traffic);
  return Object.fromEntries(FEATURES.map((name, i) => [name, values[i]]));
}

const rows = [];
for (let seed = 0; seed < SEEDS; seed += 1) {
  for (const [family, cls] of Object.entries(FAMILY_CLASS)) {
    const scenario = generate(family, seed + 1);
    const observations = observationsFrom(scenario);
    if (observations.length === 0) continue;
    const asOf = Math.max(...observations.map((o) => o.at)) + 1000;
    const traffic = computeTraffic(observations, asOf, WINDOW);

    for (const kind of ['session', 'network']) {
      const pick = (o) => (kind === 'session' ? o.sessionPseudonym : o.ipPseudonym);
      const keys = [...new Set(observations.map(pick))].filter((k) => k !== null);
      const vectors = keys
        .map((key) => computeFeatures(kind, key, observations, asOf, WINDOW, true))
        .filter((v) => v.attempts > 0)
        .sort((a, b) => b.failures - a.failures || b.attempts - a.attempts)
        .slice(0, 8);

      for (const vector of vectors) {
        // Every entity is labelled by its scenario's true class. `abstain` is not a label here — it
        // is the reject option the model exercises at scoring time when it is not confident enough,
        // which is what the risk-coverage curve measures. Population classes (outage, healthy) look
        // unremarkable per entity and are separated by the traffic features, which is the point.
        rows.push({
          ...featureRow(vector, traffic),
          label: cls,
          group: `${family}_${seed}`,
          family,
        });
      }
    }
  }
}

mkdirSync(join(HERE, 'data'), { recursive: true });
const header = [...FEATURES, 'label', 'group', 'family'];
const lines = [header.join(',')];
for (const row of rows) {
  lines.push(
    header
      .map((col) => (typeof row[col] === 'number' ? Number(row[col].toFixed(6)) : row[col]))
      .join(','),
  );
}
writeFileSync(join(HERE, 'data', 'training.csv'), lines.join('\n') + '\n', 'utf8');
console.log(
  `export — ${rows.length} rows, ${SEEDS} seeds x ${Object.keys(FAMILY_CLASS).length} families`,
);
