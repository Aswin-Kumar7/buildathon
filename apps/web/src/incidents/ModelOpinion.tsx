import { Badge, Callout, Card } from '@sentinel/ui';
import type { IncidentDetail } from '@sentinel/contracts';
import { hypothesisName } from './evidence.js';

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
 * Model B's advisory opinion — shown beside the rules, never instead of them.
 *
 * The deterministic decision stands on its own; this is the learned second opinion. When the model
 * is absent the card says the decision ran degraded on rules alone, rather than leaving a silent
 * gap that could read as the model having agreed.
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

  return (
    <Card>
      <div className="incident__head">
        <h2>Model opinion</h2>
        <div>
          {opinion.abstained ? (
            <Badge tone="warn">abstained</Badge>
          ) : (
            <Badge tone="neutral">{hypothesisName(opinion.predictedClass)}</Badge>
          )}
          <span className="incident__band"> model {opinion.modelVersion}</span>
        </div>
      </div>

      <p className="incident__band">
        {opinion.abstained
          ? `Not confident enough to call it — top guess ${hypothesisName(opinion.predictedClass)} at ${Math.round(opinion.confidence * 100)}%, below the abstain bar.`
          : `${hypothesisName(opinion.predictedClass)}, ${Math.round(opinion.confidence * 100)}% confident. Advisory — the rules decided what was done.`}
      </p>

      {/* The calibration band: the full probability distribution, so a reader sees not just the
          winner but how sure the model is across the alternatives. */}
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
                {hypothesisName(p.label)} <em>{Math.round(p.probability * 100)}%</em>
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
