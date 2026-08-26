import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card } from '@sentinel/ui';
import { modelMetricsResponseSchema, type ModelMetrics } from '@sentinel/contracts';
import { IncidentModelSection } from './IncidentModelSection.js';
import './MetricsPage.css';

async function fetchMetrics() {
  const response = await fetch('/api/model/metrics', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return modelMetricsResponseSchema.parse(await response.json());
}

const three = (value: number): string => value.toFixed(3);
const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

/**
 * The evidence label, shown wherever a number is. On synthetic data the scores are a property of
 * the generator, not of IEEE-CIS, and a reader must never mistake one for the other.
 */
function Source({ metrics }: { metrics: ModelMetrics }): React.JSX.Element {
  const real = metrics.provenance.dataSource === 'ieee-cis';
  return (
    <Badge tone={real ? 'ok' : 'warn'}>{real ? 'IEEE-CIS held-out' : 'synthetic stand-in'}</Badge>
  );
}

function band(interval: { point: number; low: number; high: number }): string {
  return `${three(interval.point)}  (${three(interval.low)}–${three(interval.high)})`;
}

function Leakage({ metrics }: { metrics: ModelMetrics }): React.JSX.Element {
  const l = metrics.leakage;
  return (
    <Card>
      <h2>The leakage delta</h2>
      <p>
        The same model, measured two ways. A careless random split lets it memorise which card is
        fraud and reuse that on the same card in the test set — a recognition it cannot repeat on a
        card it has never seen. The honest split keeps whole cards on one side, and the gap between
        the two scores is exactly how much a careless evaluation would have flattered it.
      </p>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Split</th>
            <th>PR-AUC</th>
            <th>Cards shared train↔test</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Careless (random)</td>
            <td className="is-inflated">{three(l.naivePrAuc)}</td>
            <td>{l.naiveUidOverlap.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Honest (grouped, time-ordered)</td>
            <td>{three(l.honestPrAuc)}</td>
            <td>{l.honestUidOverlap.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p className="metrics-delta">
        A careless split inflates PR-AUC by <strong>{three(l.delta)}</strong>. The headline numbers
        below come from the honest split; the {l.droppedToGap.toLocaleString()} rows in the delay
        gap were dropped so the model never trained on labels that would not yet have arrived.
      </p>
    </Card>
  );
}

function Held({ metrics }: { metrics: ModelMetrics }): React.JSX.Element {
  const h = metrics.honest;
  return (
    <Card>
      <div className="metrics-head">
        <h2>Held-out results</h2>
        <Source metrics={metrics} />
      </div>
      <dl className="incident__facts">
        <div>
          <dt>Precision</dt>
          <dd>{band(h.precision)}</dd>
        </div>
        <div>
          <dt>Recall</dt>
          <dd>{band(h.recall)}</dd>
        </div>
        <div>
          <dt>PR-AUC</dt>
          <dd>{band(h.prAuc)}</dd>
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
          <dt>Logistic baseline PR-AUC</dt>
          <dd>{three(metrics.baselineLogisticPrAuc)}</dd>
        </div>
      </dl>
      <p className="incident__band">
        {h.model} model, {h.nTest.toLocaleString()} test transactions (
        {h.positives.toLocaleString()} fraud), threshold {three(h.threshold)} chosen to minimise
        expected cost. Every figure carries its 95% bootstrap interval, because a point estimate on
        a finite test set is half a claim.
      </p>
    </Card>
  );
}

/**
 * The operating point as three actions, not one number, and the rate a merchant actually feels.
 *
 * A cost-optimal threshold decides block-or-not; running a real desk means allow / review / block,
 * and review is a capacity — a person's time — not a free tier. So the review band is capped at a
 * declared share of traffic, and the false-decline rate (good shoppers wrongly blocked) is stated
 * outright, because precision hides it when fraud is rare.
 */
function OperatingPoint({ metrics }: { metrics: ModelMetrics }): React.JSX.Element {
  const h = metrics.honest;
  const allowRate = Math.max(0, 1 - h.blockRate - h.reviewRate);
  const seg = (value: number): { flexGrow: number } => ({ flexGrow: Math.max(value, 0.001) });

  return (
    <Card>
      <h2>The operating point, as a desk runs it</h2>
      <p className="incident__band">
        The cost-optimal threshold is one number; running at it is three actions. Traffic below the
        review band is allowed, the riskiest non-blocked slice — capped at {pct(h.reviewCap)} of all
        traffic, the analyst budget — goes to a person, and above the block threshold it is stopped.
      </p>

      <div
        className="operate-bar"
        role="img"
        aria-label="allow, review and block shares of traffic"
      >
        <span className="operate-bar__seg operate-bar__seg--allow" style={seg(allowRate)}>
          allow {pct(allowRate)}
        </span>
        <span className="operate-bar__seg operate-bar__seg--review" style={seg(h.reviewRate)}>
          review {pct(h.reviewRate)}
        </span>
        <span className="operate-bar__seg operate-bar__seg--block" style={seg(h.blockRate)}>
          block {pct(h.blockRate)}
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
        The false-decline rate — legitimate shoppers wrongly blocked, as a share of all legitimate
        traffic — is the number a merchant feels and a precision figure hides when fraud is rare.
        Review is bounded on purpose: a model that flags a tenth of traffic for a human has saved
        nobody money if nobody can look at it.
      </p>
    </Card>
  );
}

/**
 * The reliability diagram: predicted probability against the fraction that was actually fraud.
 *
 * A cost-based threshold is meaningless on scores that are not probabilities, so this is the check
 * that they are. Points on the dashed line are perfectly calibrated — a 0.3 prediction is fraud
 * three times in ten — and the distance off it is the miscalibration the Brier score sums up.
 */
function Calibration({ metrics }: { metrics: ModelMetrics }): React.JSX.Element {
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
          Predicted probability (x) against the fraction actually fraud (y), in deciles. The dashed
          line is perfect calibration; the curve is the {metrics.honest.model} model after isotonic
          calibration. Brier {three(metrics.honest.brier)} — lower is better, and it is what a
          cost-based threshold quietly depends on.
        </p>
      </div>
    </Card>
  );
}

function Extras({ metrics }: { metrics: ModelMetrics }): React.JSX.Element {
  return (
    <Card>
      <h2>Where the signal is, and where the errors fall</h2>
      <h3>Feature importance (permutation, honest split)</h3>
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
      <p className="incident__band">
        The card identifiers sit near zero — the honest split gives them no value, which is the
        whole point. The signal the model actually uses is the transaction-level features, the part
        that generalises to a card it has never seen.
      </p>

      <h3>Errors by amount</h3>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Band</th>
            <th>Transactions</th>
            <th>False positives</th>
            <th>False negatives</th>
          </tr>
        </thead>
        <tbody>
          {metrics.errorTaxonomy.map((row) => (
            <tr key={row.amountBand}>
              <td>{row.amountBand}</td>
              <td>{row.n.toLocaleString()}</td>
              <td>{row.falsePositive}</td>
              <td>{row.falseNegative}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function MetricsPage(): React.JSX.Element {
  const metrics = useQuery({ queryKey: ['model-metrics'], queryFn: fetchMetrics });

  return (
    <>
      <header className="page-head">
        <h1>Model benchmark</h1>
        <p>
          Precision and recall on labels this project did not author — measured on data the model
          never saw, from a period after it trained, with whole cards kept out of its training so it
          cannot memorise them. The number that matters most is the leakage delta: the difference
          between a score and a claim.
        </p>
      </header>

      {metrics.isError && (
        <Callout tone="critical" title="Could not load the benchmark">
          <p role="alert">{metrics.error.message}</p>
        </Callout>
      )}
      {metrics.isPending && <p role="status">Loading the benchmark…</p>}

      {metrics.data !== undefined && metrics.data.available === false && (
        <Callout tone="neutral" title="The benchmark has not been generated">
          <p>{metrics.data.reason}</p>
        </Callout>
      )}

      {metrics.data !== undefined && metrics.data.available === true && (
        <>
          <Callout
            tone={metrics.data.metrics.provenance.dataSource === 'ieee-cis' ? 'neutral' : 'warn'}
            title="What these numbers are evidence of"
          >
            <p>{metrics.data.metrics.provenance.dataNote}</p>
          </Callout>
          <Leakage metrics={metrics.data.metrics} />
          <Held metrics={metrics.data.metrics} />
          <OperatingPoint metrics={metrics.data.metrics} />
          <Calibration metrics={metrics.data.metrics} />
          <Extras metrics={metrics.data.metrics} />
          <IncidentModelSection />
        </>
      )}
    </>
  );
}
