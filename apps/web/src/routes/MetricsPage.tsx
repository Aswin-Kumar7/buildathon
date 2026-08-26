import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card, ErrorState, Loading, PageHeader, Tabs } from '@sentinel/ui';
import { riskModelMetricsResponseSchema, type RiskModelMetrics } from '@sentinel/contracts';
import { ComparePage } from './ComparePage.js';
import './MetricsPage.css';

async function fetchMetrics() {
  const response = await fetch('/api/model/metrics', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return riskModelMetricsResponseSchema.parse(await response.json());
}

const three = (value: number): string => value.toFixed(3);
const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

function band(interval: { point: number; low: number; high: number }): string {
  return `${three(interval.point)}  (${three(interval.low)}–${three(interval.high)})`;
}

/**
 * The held-out headline for the *deployed* model — the same one the request path scores with, so
 * precision/recall/PR-AUC describe the model the merchant actually runs, not a benchmark beside it.
 */
function Held({ metrics }: { metrics: RiskModelMetrics }): React.JSX.Element {
  const h = metrics.honest;
  return (
    <Card>
      <div className="metrics-head">
        <h2>Held-out results</h2>
        <Badge tone="warn">synthetic corpus, held-out</Badge>
      </div>
      <dl className="incident__facts">
        <div>
          <dt>PR-AUC</dt>
          <dd>{band(h.prAuc)}</dd>
        </div>
        <div>
          <dt>Precision</dt>
          <dd>{band(h.precision)}</dd>
        </div>
        <div>
          <dt>Recall</dt>
          <dd>{band(h.recall)}</dd>
        </div>
        <div>
          <dt>F1</dt>
          <dd>{band(h.f1)}</dd>
        </div>
        <div>
          <dt>ROC-AUC</dt>
          <dd>{three(h.rocAuc)}</dd>
        </div>
        <div>
          <dt>Brier (calibration)</dt>
          <dd>{three(h.brier)}</dd>
        </div>
        <div>
          <dt>No-skill PR-AUC floor</dt>
          <dd>{three(metrics.baselineNoSkill.prAuc)}</dd>
        </div>
      </dl>
      <p className="incident__band">
        {h.nTest.toLocaleString()} test entities ({h.positives.toLocaleString()} abuse) at the
        cost-optimal block threshold {three(h.threshold)}, chosen to minimise expected cost. Every
        figure carries its 95% bootstrap interval, because a point estimate on a finite test set is
        half a claim.
      </p>
    </Card>
  );
}

/**
 * The honest heart of the page: where the model is right, and where it is not.
 *
 * An aggregate hides both. This shows, per scenario family and composition, the recall on attacks
 * and the false-positive rate on benign traffic — so a reader sees the model catch obvious
 * enumeration and struggle exactly where card testing and a biller's dunning genuinely overlap.
 */
function PerOrigin({ metrics }: { metrics: RiskModelMetrics }): React.JSX.Element {
  const rows = [...metrics.honest.perOrigin].sort((a, b) => b.meanRisk - a.meanRisk);
  return (
    <Card>
      <h2>Where the model is right, and where it is not</h2>
      <p className="incident__band">
        Per origin. For an attack the number is recall — what share it caught; for benign traffic it
        is the false-positive rate — what share it wrongly flagged. The model catches obvious and
        distributed enumeration, and its mistakes concentrate in aggressive dunning and retry
        storms, the real ambiguity a rules layer then resolves rather than a modelling artefact.
      </p>
      <div className="audit-table-wrap">
        <table className="metrics-table">
          <thead>
            <tr>
              <th>Origin</th>
              <th>Kind</th>
              <th>n</th>
              <th>Recall / FP-rate</th>
              <th>Mean risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const wrong = r.positive ? (r.recall ?? 1) < 0.9 : (r.falsePositiveRate ?? 0) > 0.1;
              return (
                <tr key={r.origin}>
                  <td>{r.origin}</td>
                  <td>
                    <Badge tone={r.positive ? 'critical' : 'neutral'}>
                      {r.positive ? 'attack' : 'benign'}
                    </Badge>
                  </td>
                  <td>{r.n}</td>
                  <td className={wrong ? 'is-inflated' : undefined}>
                    {r.positive
                      ? `recall ${three(r.recall ?? 0)}`
                      : `FP ${three(r.falsePositiveRate ?? 0)}`}
                  </td>
                  <td>{three(r.meanRisk)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * The operating point as three actions, not one number, and the rate a merchant actually feels.
 */
function OperatingPoint({ metrics }: { metrics: RiskModelMetrics }): React.JSX.Element {
  const h = metrics.honest;
  const allowRate = Math.max(0, 1 - h.blockRate - h.reviewRate);
  const seg = (value: number): { flexGrow: number } => ({ flexGrow: Math.max(value, 0.001) });

  return (
    <Card>
      <h2>The operating point, as a desk runs it</h2>
      <p className="incident__band">
        The cost-optimal threshold is one number; running at it is three actions. Traffic below the
        review band is observed, the riskiest slice — capped at {pct(h.reviewCap)} of all traffic,
        the analyst budget — goes to a person, and above the block threshold it is
        containment-eligible (still gated by the deterministic rules, never blocked by the model
        alone).
      </p>

      <div
        className="operate-bar"
        role="img"
        aria-label="observe, review and contain-eligible shares"
      >
        <span className="operate-bar__seg operate-bar__seg--allow" style={seg(allowRate)}>
          observe {pct(allowRate)}
        </span>
        <span className="operate-bar__seg operate-bar__seg--review" style={seg(h.reviewRate)}>
          review {pct(h.reviewRate)}
        </span>
        <span className="operate-bar__seg operate-bar__seg--block" style={seg(h.blockRate)}>
          contain-eligible {pct(h.blockRate)}
        </span>
      </div>

      <dl className="incident__facts">
        <div>
          <dt>False-decline rate</dt>
          <dd>{pct(h.falseDeclineRate)}</dd>
        </div>
        <div>
          <dt>Review load</dt>
          <dd>
            {pct(h.reviewRate)} <span className="incident__band">of {pct(h.reviewCap)} budget</span>
          </dd>
        </div>
        <div>
          <dt>Block / review thresholds</dt>
          <dd>
            {three(h.threshold)} / {three(h.reviewThreshold)}
          </dd>
        </div>
      </dl>

      <p className="incident__band">
        The false-decline rate is benign entities the model would put on the contain-eligible side,
        as a share of all benign traffic — eligibility, not an actual block, because the rules and
        policy still gate what is done. Review is bounded on purpose: a model that flags a tenth of
        traffic for a human has saved nobody money if nobody can look at it.
      </p>
    </Card>
  );
}

/**
 * The reliability diagram: predicted risk against the fraction that was actually abuse.
 */
function Calibration({ metrics }: { metrics: RiskModelMetrics }): React.JSX.Element {
  const points = metrics.honest.reliability;
  const size = 220;
  const pad = 4;
  const at = (v: number): number => pad + v * (size - 2 * pad);
  const line = points
    .map((p) => `${at(p.predicted).toFixed(1)},${(size - at(p.observed)).toFixed(1)}`)
    .join(' ');

  return (
    <Card>
      <h2>Calibration — do the probabilities mean what they say?</h2>
      <div className="calib">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="calib__svg"
          role="img"
          aria-label="reliability diagram"
        >
          <rect
            x={pad}
            y={pad}
            width={size - 2 * pad}
            height={size - 2 * pad}
            className="calib__frame"
          />
          <line x1={pad} y1={size - pad} x2={size - pad} y2={pad} className="calib__ideal" />
          {points.length > 1 && <polyline points={line} className="calib__curve" />}
          {points.map((p) => (
            <circle
              key={p.predicted}
              cx={at(p.predicted)}
              cy={size - at(p.observed)}
              r={3}
              className="calib__pt"
            />
          ))}
        </svg>
        <p className="incident__band calib__caption">
          Predicted risk (x) against the fraction actually abuse (y), in deciles. The dashed line is
          perfect calibration; the curve is the {metrics.honest.model} model after temperature
          scaling. Brier {three(metrics.honest.brier)} — lower is better, and it is what a
          cost-based threshold quietly depends on.
        </p>
      </div>
    </Card>
  );
}

function Leakage({ metrics }: { metrics: RiskModelMetrics }): React.JSX.Element {
  const l = metrics.leakage;
  return (
    <Card>
      <h2>The leakage delta</h2>
      <p>
        The same model, measured two ways. A careless row-wise split lets a scenario instance fall
        on both sides, so the model can be rewarded for half-remembering a seed. The grouped split
        keeps every instance on one side. On a corpus from a single seeded generator the gap is
        small — and honestly so; the dramatic leakage story belongs to the real-data IEEE-CIS
        research benchmark.
      </p>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Split</th>
            <th>PR-AUC</th>
            <th>Scenario groups shared train↔test</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Careless (row-wise)</td>
            <td className="is-inflated">{three(l.naivePrAuc)}</td>
            <td>{l.naiveGroupOverlap.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Honest (grouped by scenario)</td>
            <td>{three(l.honestPrAuc)}</td>
            <td>{l.honestGroupOverlap.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p className="metrics-delta">
        A careless split moves PR-AUC by <strong>{three(l.delta)}</strong>. The headline numbers
        come from the grouped split, where no scenario the model trained on appears in the test set.
      </p>
    </Card>
  );
}

function Extras({ metrics }: { metrics: RiskModelMetrics }): React.JSX.Element {
  return (
    <Card>
      <h2>Where the signal is, and what the features carry</h2>
      <h3>Feature importance (standardised coefficient, exact for a linear model)</h3>
      <ul className="metrics-bars">
        {metrics.featureImportance.slice(0, 8).map((f) => (
          <li key={f.feature}>
            <span className="metrics-bar__label">{f.feature}</span>
            <span
              className="metrics-bar"
              style={{ width: `${Math.max(2, Math.round(f.importance * 300))}%` }}
            />
            <span className="metrics-bar__value">{three(f.importance)}</span>
          </li>
        ))}
      </ul>

      <h3>Ablation ladder (PR-AUC)</h3>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Features</th>
            <th>Count</th>
            <th>PR-AUC</th>
          </tr>
        </thead>
        <tbody>
          {metrics.ablation.map((row) => (
            <tr key={row.features}>
              <td>{row.features}</td>
              <td>{row.nFeatures}</td>
              <td>{three(row.prAuc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="incident__band">
        Remove the traffic-context features and the model loses the ability to tell an outage's
        failures from a masked attack — the ladder shows it rather than asserting it.
      </p>
    </Card>
  );
}

function Evaluation(): React.JSX.Element {
  const metrics = useQuery({ queryKey: ['model-metrics'], queryFn: fetchMetrics });

  if (metrics.isPending) return <Loading label="Loading the model…" />;
  if (metrics.isError)
    return <ErrorState title="Could not load the model" message={metrics.error.message} />;
  if (metrics.data.available === false) {
    return (
      <Callout tone="neutral" title="The model has not been generated">
        <p>{metrics.data.reason}</p>
      </Callout>
    );
  }
  const model = metrics.data.model;
  return (
    <>
      <Callout tone="warn" title="These labels are synthetic, not real-world outcomes">
        <p>{model.provenance.dataNote}</p>
      </Callout>
      <Held metrics={model} />
      <PerOrigin metrics={model} />
      <OperatingPoint metrics={model} />
      <Calibration metrics={model} />
      <Leakage metrics={model} />
      <Extras metrics={model} />
    </>
  );
}

const TABS = [
  { id: 'evaluation', label: 'Model evaluation' },
  { id: 'decides', label: 'How it decides' },
];

export function MetricsPage(): React.JSX.Element {
  const [tab, setTab] = useState('evaluation');

  return (
    <>
      <PageHeader
        eyebrow="Analyze"
        title="Risk & Model"
        description="The card-testing risk model the request path actually scores with — measured on a held-out split, and shown deciding three cases that look identical until you see the whole shop."
        actions={<Tabs items={TABS} active={tab} onChange={setTab} />}
      />

      {tab === 'evaluation' ? <Evaluation /> : <ComparePage embedded />}
    </>
  );
}
