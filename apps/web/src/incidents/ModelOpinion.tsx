import { Badge, Callout, Card } from '@sentinel/ui';
import type { IncidentDetail } from '@sentinel/contracts';

const FEATURE_LABEL: Record<string, string> = {
  log_attempts: 'how many attempts',
  failure_rate: 'failure rate',
  approval_rate: 'approval rate',
  infra_share: 'gateway-blamed share',
  cards_per_attempt: 'cards per attempt',
  small_amount_share: 'small-amount share',
  burstiness: 'arrival regularity',
  recovery_rate: 'recovery rate',
  top_session_failure_share: 'one session\u2019s share of failure',
  log_failing_sessions: 'how many sessions failing',
};

const featureLabel = (f: string): string => FEATURE_LABEL[f] ?? f.replace(/_/g, ' ');

/**
 * Model B's verdict, and — the part that matters — how it moved the decision.
 *
 * The model is a driver here, not a passenger: it can escalate a case the rules would have
 * suppressed, hold back a containment it disputes, or raise a case the rules never opened. The
 * `Influence` line says which of those happened, on a short leash: the model never blocks a shopper
 * on its own, and when the artefact is absent the decision runs on rules alone (`degraded:model`)
 * rather than leaving a silent gap that could read as the model having agreed.
 */
export function ModelOpinion({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  if (!incident.modelAvailable) {
    return (
      <Card>
        <h2>Model opinion</h2>
        <Callout tone="warn" title="Rules only — degraded:model">
          <p>
            The model artefact is not loaded, so this decision rests on the deterministic rules and
            arbitration alone. That is by design: the model informs the decision and was never
            allowed to be it, so its absence degrades the explanation, not the safety of the action.
          </p>
        </Callout>
      </Card>
    );
  }

  const opinion = incident.modelOpinion;
  if (opinion === null) {
    return (
      <Card>
        <h2>Model opinion</h2>
        <p>Not scored in the last detection pass.</p>
      </Card>
    );
  }

  const riskPct = Math.round(opinion.risk * 100);

  return (
    <Card>
      <div className="incident__head">
        <h2>Model opinion</h2>
        <div>
          <Badge tone={opinion.predictedClass === 'benign' ? 'ok' : 'critical'}>
            risk {riskPct}%
          </Badge>
          <span className="incident__band"> model {opinion.modelVersion}</span>
        </div>
      </div>

      <p className="incident__band">
        {opinion.abstained
          ? `Card-testing risk ${riskPct}% — in the review band, so the model would defer to a person rather than decide.`
          : opinion.predictedClass === 'benign'
            ? `Card-testing risk ${riskPct}% — the model reads this as benign.`
            : `Card-testing risk ${riskPct}% — the model reads this as abuse.`}
      </p>

      <Influence influence={incident.arbitration?.modelInfluence ?? 'none'} />

      {/* The calibration bar: benign against abuse, so a reader sees not just the call but how far
          the risk sits from the boundary. */}
      <h3>How the model splits it</h3>
      <ul className="compare__fits">
        {[...opinion.probabilities]
          .sort((a, b) => b.probability - a.probability)
          .map((p) => (
            <li key={p.label} className={p.label === opinion.predictedClass ? 'is-best' : ''}>
              <span
                className="compare__bar"
                style={{ width: `${Math.round(p.probability * 100)}%` }}
              />
              <span className="compare__label">
                {p.label === 'abuse' ? 'card testing' : 'benign'}{' '}
                <em>{Math.round(p.probability * 100)}%</em>
              </span>
            </li>
          ))}
      </ul>

      {/* Why flagged: the exact per-feature contributions (SHAP for a linear model). */}
      <h3>Why the model leans this way</h3>
      <ul className="abstentions">
        {opinion.contributions.map((c) => (
          <li key={c.feature}>
            <strong>
              {c.contribution >= 0 ? '+' : ''}
              {c.contribution.toFixed(2)}
            </strong>{' '}
            {featureLabel(c.feature)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// How the model moved this decision — the difference between a passenger and a driver, shown plainly.
const INFLUENCE: Record<string, { tone: 'ok' | 'warn' | 'neutral'; text: string }> = {
  corroborated: {
    tone: 'ok',
    text: 'The model agreed with the rules and strengthened the call — it was not just watching.',
  },
  escalated: {
    tone: 'warn',
    text: 'The model escalated this. The rules alone would have let it pass; the model was confident enough of an attack to put it in front of a person.',
  },
  deescalated: {
    tone: 'warn',
    text: 'The model held containment back. The rules would have contained automatically; the model was not convinced, so a person decides rather than a shopper being blocked.',
  },
  flagged: {
    tone: 'warn',
    text: 'The model raised this on its own — no single-entity rule fired, but the model recognised an attack and sent it to review. This is the distributed, low-and-slow case a burst gate cannot see.',
  },
};

function Influence({ influence }: { influence: string }): React.JSX.Element {
  const shown = INFLUENCE[influence];
  if (shown === undefined) {
    return (
      <p className="incident__band">
        The model did not move this decision — it agreed there was nothing to act on, or was not
        sure enough to weigh in. It can escalate, hold back or raise a case on its own; here it did
        not.
      </p>
    );
  }
  return (
    <Callout tone={shown.tone} title={`Model influence: ${influence}`}>
      <p>{shown.text}</p>
    </Callout>
  );
}
