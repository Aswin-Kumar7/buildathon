import { Shield, Pulse, WarningCircle, FileCode } from '@phosphor-icons/react';
import { RiskGauge } from '../components/RiskGauge.js';
import type { IncidentDetail, ModelOpinion } from '@sentinel/contracts';

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

function classPhrase(opinion: ModelOpinion): string {
  if (opinion.abstained) return 'borderline — the model would route this to a person';
  return opinion.predictedClass === 'abuse' ? 'card testing' : 'ordinary, legitimate traffic';
}

function RiskScoreCard({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const opinion = incident.modelOpinion;
  const influence = incident.arbitration?.modelInfluence ?? 'none';
  const inf = INFLUENCE_LABEL[influence] ?? { text: 'Did not move the decision', tone: 'neutral' };
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 32px',
            width: '32px',
            height: '32px',
            borderRadius: '9px',
            background: 'oklch(0.962 0.024 258)',
          }}
        >
          <Shield size={16} color="oklch(0.46 0.12 258)" />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2
              style={{
                margin: 0,
                fontSize: '14.5px',
                fontWeight: 600,
                letterSpacing: '-0.018em',
                color: 'oklch(0.21 0.015 280)',
              }}
            >
              Risk score
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color:
                  incident.band === 'high'
                    ? 'oklch(0.48 0.15 22)'
                    : incident.band === 'medium'
                      ? 'oklch(0.45 0.12 70)'
                      : 'oklch(0.4 0.11 162)',
                background:
                  incident.band === 'high'
                    ? 'oklch(0.958 0.026 22)'
                    : incident.band === 'medium'
                      ? 'oklch(0.965 0.03 70)'
                      : 'oklch(0.955 0.03 162)',
              }}
            >
              {incident.band === 'high'
                ? 'High Risk'
                : incident.band === 'medium'
                  ? 'Medium Risk'
                  : 'Low Risk'}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            The score for this connected activity.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          padding: '20px 20px 8px',
        }}
      >
        <div style={{ position: 'relative', width: '128px' }}>
          <RiskGauge
            score={incident.score}
            level={incident.band}
            size="sm"
            hideBox={true}
            hideReadout={true}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
          <span
            style={{
              fontSize: '30px',
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              color: 'oklch(0.19 0.015 280)',
            }}
          >
            {Math.round(incident.score * 100)}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'oklch(0.62 0.015 280)' }}>
            /100
          </span>
        </div>
        <span
          style={{
            padding: '3px 10px',
            borderRadius: 'var(--s-radius-pill)',
            fontSize: '11.5px',
            fontWeight: 600,
            color:
              incident.band === 'high'
                ? 'oklch(0.48 0.15 22)'
                : incident.band === 'medium'
                  ? 'oklch(0.45 0.12 70)'
                  : 'oklch(0.44 0.015 280)',
            background:
              incident.band === 'high'
                ? 'oklch(0.958 0.026 22)'
                : incident.band === 'medium'
                  ? 'oklch(0.965 0.03 70)'
                  : 'oklch(0.958 0.006 280)',
          }}
        >
          {incident.band === 'high'
            ? 'High risk'
            : incident.band === 'medium'
              ? 'Medium risk'
              : 'Low risk'}
        </span>
      </div>

      {opinion !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            margin: '8px 20px 0',
            padding: '11px 13px',
            borderRadius: '10px',
            background: 'oklch(0.972 0.004 270)',
          }}
        >
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            Estimated abuse risk
          </span>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              color: 'oklch(0.2 0.015 280)',
            }}
          >
            {Math.round(opinion.risk * 100)}%
          </span>
        </div>
      )}

      <div style={{ padding: '12px 20px 18px' }}>
        <span
          style={{
            display: 'inline-flex',
            padding: '3px 10px',
            borderRadius: 'var(--s-radius-pill)',
            fontSize: '11.5px',
            fontWeight: 600,
            color: 'oklch(0.44 0.015 280)',
            background: 'oklch(0.958 0.006 280)',
          }}
        >
          {inf.text}
        </span>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: '12.5px',
            fontWeight: 500,
            lineHeight: 1.65,
            color: 'oklch(0.48 0.015 280)',
            textWrap: 'pretty',
          }}
        >
          This is the incident's risk score — the same one shown at the top of the page. It reflects
          the connected activity as a whole, never a single payment.
        </p>
      </div>
    </section>
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
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 32px',
            width: '32px',
            height: '32px',
            borderRadius: '9px',
            background: 'oklch(0.962 0.024 258)',
          }}
        >
          <Pulse size={16} color="oklch(0.46 0.12 258)" />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: '14.5px',
              fontWeight: 600,
              letterSpacing: '-0.018em',
              color: 'oklch(0.21 0.015 280)',
            }}
          >
            What the model weighed
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            How much each signal pushed the estimate up or down.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '11px', padding: '18px 20px' }}>
        {rows.map((c) => {
          const positive = c.contribution >= 0;
          const width = Math.round((Math.abs(c.contribution) / maxAbs) * 100);
          return (
            <div
              key={c.feature}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 172px) minmax(0, 1fr) 52px',
                gap: '14px',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'oklch(0.34 0.015 280)' }}>
                {featureLabel(c.feature)}
              </span>
              <span
                style={{
                  position: 'relative',
                  height: '6px',
                  borderRadius: '99px',
                  background: 'oklch(0.95 0.006 280)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${width}%`,
                    background: positive ? 'oklch(0.62 0.17 22)' : 'oklch(0.44 0.14 162)',
                    borderRadius: '99px',
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  color: positive ? 'oklch(0.48 0.15 22)' : 'oklch(0.4 0.11 162)',
                }}
              >
                {positive ? '+' : ''}
                {c.contribution.toFixed(2)}
              </span>
            </div>
          );
        })}
        <p
          style={{
            margin: '4px 0 0',
            fontSize: '11.5px',
            fontWeight: 500,
            lineHeight: 1.6,
            color: 'oklch(0.58 0.015 280)',
            textWrap: 'pretty',
          }}
        >
          Each value shows how strongly that signal pushed the estimate. Positive points toward card
          testing; negative argues against it.
        </p>
      </div>
    </section>
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
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: '0 0 32px',
            width: '32px',
            height: '32px',
            borderRadius: '9px',
            background: 'oklch(0.962 0.024 258)',
          }}
        >
          <WarningCircle size={16} color="oklch(0.46 0.12 258)" />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontSize: '14.5px',
              fontWeight: 600,
              letterSpacing: '-0.018em',
              color: 'oklch(0.21 0.015 280)',
            }}
          >
            Main reasons
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            The signals that shaped this estimate the most.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((c, index) => {
          const tag = impact(c.contribution, maxAbs);
          return (
            <div
              key={c.feature}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px 20px',
                ...(index < rows.length - 1 && {
                  borderBottom: '1px solid oklch(0.968 0.006 280)',
                }),
              }}
            >
              <span
                style={{
                  flex: '0 0 22px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'oklch(0.66 0.015 280)',
                }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                <span
                  style={{ fontSize: '12.5px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}
                >
                  {featureLabel(c.feature)}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: tag.tone === 'critical' ? 'oklch(0.48 0.15 22)' : 'oklch(0.4 0.11 162)',
                  }}
                >
                  {tag.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
        marginBottom: '14px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 32px',
              width: '32px',
              height: '32px',
              borderRadius: '99px',
              background: 'oklch(0.962 0.024 258)',
            }}
          >
            <FileCode size={16} color="oklch(0.46 0.12 258)" />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: '14.5px',
                fontWeight: 600,
                letterSpacing: '-0.018em',
                color: 'oklch(0.21 0.015 280)',
              }}
            >
              In plain words
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              A written summary of this assessment.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onViewEvidence}
          style={{
            border: 0,
            background: 'transparent',
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'oklch(0.42 0.12 258)',
            cursor: 'pointer',
          }}
        >
          View signal evidence →
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '18px 20px' }}>
        <p
          style={{
            margin: 0,
            maxWidth: '108ch',
            fontSize: '13px',
            fontWeight: 500,
            lineHeight: 1.7,
            color: 'oklch(0.3 0.015 280)',
            textWrap: 'pretty',
          }}
        >
          This incident scored {scorePct}/100 ({band.label}).{' '}
          {INFLUENCE_SENTENCE[influence] ?? INFLUENCE_SENTENCE.none} The model assessed the same
          connected activity on its own — its estimate of abuse risk was {modelPct}%, and it saw the
          activity as {classPhrase(opinion)}.{strongest}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: '12.5px',
            fontWeight: 500,
            color: 'oklch(0.54 0.015 280)',
          }}
        >
          The model looks at the connected activity as a whole, not any single payment.
        </p>
      </div>
    </section>
  );
}

function Unavailable({ available }: { available: boolean }): React.JSX.Element {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        padding: '20px',
      }}
    >
      <p style={{ margin: 0, fontSize: '13px', fontWeight: 500, color: 'oklch(0.5 0.015 280)' }}>
        {available
          ? 'The model did not score this incident on the last detection pass, so there is no model assessment to show.'
          : 'Model assessment unavailable — the model artefact is not loaded, so this incident was decided on the deterministic rules alone (degraded:model). Missing data is not treated as low risk.'}
      </p>
    </section>
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.35fr) minmax(0, 1fr)',
              gap: '12px',
              marginBottom: '14px',
              alignItems: 'start',
            }}
          >
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
