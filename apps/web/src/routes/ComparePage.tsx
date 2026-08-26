import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card } from '@sentinel/ui';
import {
  comparisonResponseSchema,
  type ComparisonCase,
  type ComparisonResponse,
  type DecisionDto,
} from '@sentinel/contracts';
import {
  costPhrase,
  decisionLabel,
  expectationPhrase,
  hypothesisName,
} from '../incidents/evidence.js';
import './ComparePage.css';

async function fetchComparison(): Promise<ComparisonResponse> {
  const response = await fetch('/api/incidents/compare', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return comparisonResponseSchema.parse(await response.json());
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

const DECISION_TONE: Record<DecisionDto, 'critical' | 'warn' | 'neutral' | 'ok'> = {
  contain: 'critical',
  review: 'warn',
  monitor: 'neutral',
  none: 'ok',
};

function Facts({ rows }: { rows: [string, string][] }): React.JSX.Element {
  return (
    <dl className="compare__facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Every explanation weighed, and what the winner expected.
 *
 * The rejected ones are shown at their own probability rather than dropped. A verdict without
 * the alternatives is an assertion, and the runner-up is the thing a reader most needs in order
 * to tell a conclusion from a coin toss.
 */
function Explanations({ item }: { item: ComparisonCase }): React.JSX.Element {
  const winner = item.arbitration.fits[0]!;

  return (
    <>
      <h3>Explanations</h3>
      <ul className="compare__fits">
        {item.arbitration.fits.map((fit) => (
          <li
            key={fit.hypothesis}
            className={fit.hypothesis === item.arbitration.best ? 'is-best' : ''}
          >
            <span
              className="compare__bar"
              style={{ width: `${Math.round(fit.probability * 100)}%` }}
            />
            <span className="compare__label">
              {hypothesisName(fit.hypothesis)} <em>{pct(fit.probability)}</em>
            </span>
          </li>
        ))}
      </ul>
      <p className="compare__margin">
        Beat {hypothesisName(item.arbitration.runnerUp)} by{' '}
        {Math.round(item.arbitration.margin * 100)} points.
      </p>

      <h3>What it expected, and got</h3>
      <ul className="compare__expectations">
        {winner.expectations.map((expectation) => (
          <li key={expectation.code} className={expectation.met ? 'is-met' : 'is-unmet'}>
            <span aria-hidden="true">{expectation.met ? '✓' : '✗'}</span>{' '}
            {expectationPhrase(expectation)}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * One scenario, in the same layout as the others.
 *
 * Identical layout is the whole argument. Three columns of the same rows, differing only in
 * their numbers and their conclusion, let a reader see that the system reached three answers
 * from one policy — which is a claim that cannot be made convincingly in a sentence.
 */
function Column({ item }: { item: ComparisonCase }): React.JSX.Element {
  return (
    <Card>
      <header className="compare__head">
        <h2>{item.title}</h2>
        <Badge tone={item.classification === 'attack' ? 'critical' : 'neutral'}>
          {item.classification}
        </Badge>
      </header>

      <h3>The entity</h3>
      <Facts
        rows={[
          ['Attempts', String(item.attempts)],
          ['Failures', String(item.failures)],
          ['Distinct cards', item.distinctCards === null ? '—' : String(item.distinctCards)],
          ['Approved', pct(item.approvalRate)],
        ]}
      />

      {/* The half a per-entity view cannot supply, and the reason these three separate at all. */}
      <h3>The shop around it</h3>
      <Facts
        rows={[
          ['Approved', pct(item.traffic.approvalRate)],
          ['Gateway blamed', pct(item.traffic.infrastructureFailureShare)],
          ['Sessions failing', `${item.traffic.failingSessions} of ${item.traffic.activeSessions}`],
          ['Worst one’s share', pct(item.traffic.topSessionFailureShare)],
        ]}
      />

      <Explanations item={item} />

      <div className="compare__decision">
        <Badge tone={DECISION_TONE[item.arbitration.decision]}>
          {decisionLabel(item.arbitration.decision)}
        </Badge>
        {item.arbitration.abstained && <Badge tone="warn">abstained</Badge>}
      </div>

      {/* Not symmetric, and never presented as if it were. */}
      <dl className="compare__cost">
        <div>
          <dt>If we act and are wrong</dt>
          <dd>{costPhrase(item.counterfactual.ifWrongToAct)}</dd>
        </div>
        <div>
          <dt>If we wait and are wrong</dt>
          <dd>{costPhrase(item.counterfactual.ifWrongToWait)}</dd>
        </div>
      </dl>
    </Card>
  );
}

export function ComparePage({ embedded = false }: { embedded?: boolean } = {}): React.JSX.Element {
  const comparison = useQuery({ queryKey: ['comparison'], queryFn: fetchComparison });

  return (
    <>
      {!embedded && (
        <header className="page-head">
          <h1>Three that look alike</h1>
          <p>
            A card-testing attack, an acquirer outage and a subscription biller working through
            renewals. All three are one entity failing over and over, and the only thing that tells
            them apart is what the rest of the shop was doing at the time. The same thresholds judge
            all three — nothing below is configured per scenario.
          </p>
        </header>
      )}

      {comparison.isError && (
        <Callout tone="critical" title="Could not load the comparison">
          <p role="alert">{comparison.error.message}</p>
        </Callout>
      )}

      {comparison.isPending && <p role="status">Judging three scenarios…</p>}

      {comparison.data !== undefined && (
        <>
          <section className="compare">
            {comparison.data.cases.map((item) => (
              <Column key={item.family} item={item} />
            ))}
          </section>
          <p className="incident-meta">
            Judged by threshold set <code>{comparison.data.thresholdHash}</code>, computed from the
            committed corpus rather than from stored traffic — so this works on a clean clone and
            cannot be improved by seeding a friendlier database.
          </p>
        </>
      )}
    </>
  );
}
