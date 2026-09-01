import { Shield, Pulse, WarningCircle, FileCode } from '@phosphor-icons/react';
import { Card } from '@sentinel/ui';
import { RiskGauge } from '../components/RiskGauge.js';
import type { IncidentDetail, ModelOpinion } from '@sentinel/contracts';
import './IncidentModelAssessment.css';

/* ------------------------------------------------------------------------------------------------
 * Incident → Model assessment tab
 *
 * The deployed model's INCIDENT/ENTITY-level assessment, from the incident detail payload's
 * `modelOpinion` (risk = P(abuse), band, predicted class, signed per-feature SHAP contributions,
 * version) plus `arbitration.modelInfluence`, enriched with the served model's registry metadata
 * (`GET /api/model/registry`). Nothing is scored in React and nothing is invented: the gauge maps
 * the backend `risk`, the breakdown IS the model's real contributions (not invented categories),
 * and the explanation is composed deterministically from real fields. No per-payment scoring.
 * ---------------------------------------------------------------------------------------------- */

const FEATURE_LABEL: Record<string, string> = {
  log_attempts: 'Attempt volume',
  failure_rate: 'Failure rate',
  approval_rate: 'Approval rate',
  infra_share: 'Gateway-blamed failures',
  cards_per_attempt: 'Cards per attempt',
  small_amount_share: 'Small-amount share',
  burstiness: 'Arrival regularity',
  recovery_rate: 'Recovery rate',
  top_session_failure_share: 'Concentrated session failure',
  log_failing_sessions: 'Failing sessions',
};
export const featureLabel = (feature: string): string => {
  if (FEATURE_LABEL[feature] !== undefined) return FEATURE_LABEL[feature];
  const text = feature.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// The canonical incident risk band (rule-based score), the same field the page header shows — so the
// gauge and the header can never disagree. This is deliberately NOT the model's own band.
const INCIDENT_BAND: Record<IncidentDetail['band'], { label: string; tone: string }> = {
  high: { label: 'High risk', tone: 'critical' },
  medium: { label: 'Medium risk', tone: 'warn' },
  low: { label: 'Low risk', tone: 'ok' },
};

const INFLUENCE_LABEL: Record<string, { text: string; tone: string }> = {
  corroborated: { text: 'Corroborated the score', tone: 'ok' },
  escalated: { text: 'Escalated the decision', tone: 'critical' },
  deescalated: { text: 'Argued for a softer action', tone: 'warn' },
  flagged: { text: 'Flagged on its own', tone: 'critical' },
  none: { text: 'Did not move the decision', tone: 'neutral' },
};

const INFLUENCE_SENTENCE: Record<string, string> = {
  corroborated: 'It agreed with the rules and strengthened the call.',
  escalated: 'It escalated a case the rules alone would have let pass.',
  deescalated: 'It held containment back for a person to review.',
  flagged: 'It raised this case on its own, before any single-entity rule fired.',
  none: 'It did not move the rule-based decision.',
};

function Gauge({ risk, band }: { risk: number; band?: string }): React.JSX.Element {
  return <RiskGauge score={risk} level={band} size="sm" hideBox={true} />;
}

function CardHeaderTitle({
  icon,
  text,
  badgeTone,
}: {
  icon: React.ReactNode;
  text: string;
  badgeTone: string;
}): React.JSX.Element {
  return (
    <div className="ad-card-head-inner">
      <span className={`ad-card-badge ad-card-badge--${badgeTone}`}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function classPhrase(opinion: ModelOpinion): string {
  if (opinion.abstained) return 'borderline — the model would route this to a person';
  return opinion.predictedClass === 'abuse' ? 'card testing' : 'ordinary, legitimate traffic';
}

function RiskScoreCard({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const opinion = incident.modelOpinion;
  const influence = incident.arbitration?.modelInfluence ?? 'none';
  const inf = INFLUENCE_LABEL[influence] ?? { text: 'Did not move the decision', tone: 'neutral' };
  return (
    <Card title={<CardHeaderTitle icon={<Shield />} text="Risk score" badgeTone="blue" />}>
      <div className="ma-gauge">
        <Gauge risk={incident.score} band={incident.band} />
      </div>
      {opinion !== null && (
        <div className="ma-modelread">
          <span className="ma-modelread__label">Estimated abuse risk</span>
          <strong className="ma-modelread__val">{Math.round(opinion.risk * 100)}%</strong>
          <span className={`ma-influence ma-influence--${inf.tone}`}>{inf.text}</span>
        </div>
      )}
      <p className="ma-note">
        This is the incident’s risk score — the same one shown at the top of the page. It reflects
        the connected activity as a whole, never a single payment. The model’s own estimate is shown
        above.
      </p>
    </Card>
  );
}

function ScoreBreakdownCard({
  contributions,
}: {
  contributions: ModelOpinion['contributions'];
}): React.JSX.Element {
  const maxAbs = Math.max(1e-6, ...contributions.map((c) => Math.abs(c.contribution)));
  const rows = [...contributions].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  return (
    <Card
      title={<CardHeaderTitle icon={<Pulse />} text="What the model weighed" badgeTone="purple" />}
      subtitle="How much each signal pushed the estimate up or down."
    >
      <ul className="ma-bars">
        {rows.map((c) => {
          const positive = c.contribution >= 0;
          const width = Math.round((Math.abs(c.contribution) / maxAbs) * 100);
          return (
            <li key={c.feature}>
              <span className="ma-bar__label">{featureLabel(c.feature)}</span>
              <span className="ma-bar__track">
                <span
                  className={`ma-bar__fill ma-bar__fill--${positive ? 'up' : 'down'}`}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="ma-bar__val">
                {positive ? '+' : ''}
                {c.contribution.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="ma-note">
        Each value shows how strongly that signal pushed the estimate. Positive points toward card
        testing; negative argues against it.
      </p>
    </Card>
  );
}

function impact(contribution: number, maxAbs: number): { label: string; tone: string } {
  const ratio = Math.abs(contribution) / maxAbs;
  const strength = ratio > 0.6 ? 'Strong' : ratio > 0.3 ? 'Moderate' : 'Slight';
  return contribution >= 0
    ? { label: `${strength} push toward card testing`, tone: 'critical' }
    : { label: `${strength} push against`, tone: 'ok' };
}

function TopFactorsCard({
  contributions,
}: {
  contributions: ModelOpinion['contributions'];
}): React.JSX.Element {
  const maxAbs = Math.max(1e-6, ...contributions.map((c) => Math.abs(c.contribution)));
  const rows = [...contributions]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 4);
  return (
    <Card
      title={<CardHeaderTitle icon={<WarningCircle />} text="Main reasons" badgeTone="amber" />}
      subtitle="The signals that shaped this estimate the most."
    >
      <ol className="ma-factors">
        {rows.map((c, index) => {
          const tag = impact(c.contribution, maxAbs);
          return (
            <li key={c.feature}>
              <span className="ma-factors__num">{String(index + 1).padStart(2, '0')}</span>
              <span className="ma-factors__text">
                <strong>{featureLabel(c.feature)}</strong>
                <span className={`ma-impact ma-impact--${tag.tone}`}>{tag.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function ExplanationCard({
  incident,
  opinion,
  onViewEvidence,
}: {
  incident: IncidentDetail;
  opinion: ModelOpinion;
  onViewEvidence: () => void;
}): React.JSX.Element {
  const scorePct = Math.round(incident.score * 100);
  const modelPct = Math.round(opinion.risk * 100);
  const band = INCIDENT_BAND[incident.band];
  const influence = incident.arbitration?.modelInfluence ?? 'none';
  const top = [...opinion.contributions]
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((c) => featureLabel(c.feature).toLowerCase());
  const strongest = top.length > 0 ? ` Its strongest signals were ${top.join(' and ')}.` : '';
  return (
    <Card
      title={<CardHeaderTitle icon={<FileCode />} text="In plain words" badgeTone="green" />}
      actions={
        <button type="button" className="ma-link" onClick={onViewEvidence}>
          View signal evidence →
        </button>
      }
    >
      <p className="ma-explain">
        This incident scored {scorePct}/100 ({band.label}).{' '}
        {INFLUENCE_SENTENCE[influence] ?? INFLUENCE_SENTENCE.none} The model assessed the same
        connected activity on its own — its estimate of abuse risk was {modelPct}%, and it saw the
        activity as {classPhrase(opinion)}.{strongest}
      </p>
      <p className="ma-note">
        The model looks at the connected activity as a whole, not any single payment.
      </p>
    </Card>
  );
}

function Unavailable({ available }: { available: boolean }): React.JSX.Element {
  return (
    <Card title="Risk assessment">
      <p className="ma-unavailable">
        {available
          ? 'The model did not score this incident on the last detection pass, so there is no model assessment to show.'
          : 'Model assessment unavailable — the model artefact is not loaded, so this incident was decided on the deterministic rules alone (degraded:model). Missing data is not treated as low risk.'}
      </p>
    </Card>
  );
}

export function ModelAssessmentTab({
  incident,
  onViewEvidence,
}: {
  incident: IncidentDetail;
  onViewEvidence: () => void;
}): React.JSX.Element {
  const opinion = incident.modelOpinion;

  return (
    <div className="ma">
      {!incident.modelAvailable || opinion === null ? (
        <Unavailable available={incident.modelAvailable} />
      ) : (
        <>
          <div className="ma-grid">
            <RiskScoreCard incident={incident} />
            <ScoreBreakdownCard contributions={opinion.contributions} />
            <TopFactorsCard contributions={opinion.contributions} />
          </div>
          <ExplanationCard incident={incident} opinion={opinion} onViewEvidence={onViewEvidence} />
        </>
      )}
    </div>
  );
}
