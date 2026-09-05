import {
  WarningCircle,
  CreditCard,
  Clock,
  CheckCircle,
  TrendUp,
  Ruler,
  Laptop,
} from '@phosphor-icons/react';
import type { IncidentDetail } from '@sentinel/contracts';
import {
  decisionLabel,
  evidenceImpact,
  evidenceObserved,
  evidenceThreshold,
  hypothesisName,
  ruleName,
  signalDescription,
  signalLabel,
} from '../incidents/evidence.js';
import { formatWindow } from '../shared/time.js';

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

function whyText(it: IncidentDetail): string {
  const count = it.firedRules.length;
  const window = formatWindow(it.lastActivityAt - it.firstAttemptAt);
  const lead =
    count === 0
      ? `We reviewed the payment activity in this incident over ${window}`
      : `${count} warning ${count === 1 ? 'sign' : 'signs'} showed up in this incident within ${window}`;
  return `${lead}. Together they point to ${hypothesisName(it.primaryHypothesis).toLowerCase()}, and Sentinel’s recommendation is to ${decisionLabel(it.recommendedDecision).toLowerCase()}.`;
}

type BehaviourRow = {
  signal: string;
  observed: string;
  context: string;
  icon: React.JSX.Element;
};

function behaviourRows(it: IncidentDetail): BehaviourRow[] {
  const rows: BehaviourRow[] = [];
  const cards = it.distinctCards ?? (it.graph.cards.length > 0 ? it.graph.cards.length : null);
  if (cards !== null) {
    rows.push({
      signal: 'Different cards',
      observed: `${cards}`,
      context: `linked to this ${it.entityKind}`,
      icon: <CreditCard size={15} color="oklch(0.48 0.015 280)" />,
    });
  }
  if (it.attempts > 0) {
    rows.push({
      signal: 'Attempts',
      observed: `${it.attempts}`,
      context: `over ${formatWindow(it.lastActivityAt - it.firstAttemptAt)}`,
      icon: <Clock size={15} color="oklch(0.48 0.015 280)" />,
    });
    rows.push({
      signal: 'Failed attempts',
      observed: `${it.failures}`,
      context: `${Math.round((it.failures / it.attempts) * 100)}% of attempts`,
      icon: <WarningCircle size={15} color="oklch(0.48 0.015 280)" />,
    });
  }
  if (it.relatedOrders.length > 0) {
    const captured = it.relatedOrders
      .flatMap((order) => order.attempts)
      .filter((attempt) => attempt.status === 'captured').length;
    rows.push({
      signal: 'Captured',
      observed: `${captured}`,
      context: captured > 0 ? 'a payment got through' : 'nothing got through',
      icon: <CheckCircle size={15} color="oklch(0.48 0.015 280)" />,
    });
  }
  if (it.entityKind === 'network' && it.graph.sessions.length > 0) {
    rows.push({
      signal: 'Sessions involved',
      observed: `${it.graph.sessions.length}`,
      context: 'checkout sessions on this network',
      icon: <Laptop size={15} color="oklch(0.48 0.015 280)" />,
    });
  }
  const velocity = it.evidence.find((e) => e.code === 'attempt_rate_above_threshold');
  if (velocity !== undefined) {
    rows.push({
      signal: 'Peak attempt rate',
      observed: evidenceObserved(velocity),
      context: `fires past ${evidenceThreshold(velocity)}`,
      icon: <TrendUp size={15} color="oklch(0.48 0.015 280)" />,
    });
  }
  const cadence = it.evidence.find((e) => e.code === 'inter_arrival_variation_low');
  if (cadence !== undefined) {
    rows.push({
      signal: 'Timing regularity',
      observed: cadence.observed.toFixed(2),
      context: 'lower is more machine-like',
      icon: <Clock size={15} color="oklch(0.48 0.015 280)" />,
    });
  }
  return rows;
}

function TriggeredRules({ it }: { it: IncidentDetail }): React.JSX.Element {
  const rules = it.evidence.filter((e) => e.weight > 0).sort((a, b) => b.weight - a.weight);
  if (rules.length === 0) {
    return (
      <p
        style={{
          padding: '16px 20px',
          margin: 0,
          fontSize: '13px',
          fontWeight: 500,
          color: 'oklch(0.56 0.015 280)',
        }}
      >
        No unusual patterns stood out on the last check.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Table Header Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 1.5fr) 100px 116px 92px',
          gap: '14px',
          padding: '10px 20px',
          background: 'oklch(0.984 0.003 270)',
          borderTop: '1px solid oklch(0.955 0.006 280)',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
          fontSize: '10.5px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'oklch(0.56 0.015 280)',
        }}
      >
        <span>WHAT WE SAW</span>
        <span style={{ textAlign: 'right' }}>OBSERVED</span>
        <span style={{ textAlign: 'right' }}>EXPECTED LIMIT</span>
        <span style={{ textAlign: 'right' }}>CONCERN</span>
      </div>

      {/* Table Rows */}
      {rules.map((e, index) => {
        const impact = evidenceImpact(e.weight);
        const dotColor =
          impact === 'high'
            ? 'oklch(0.62 0.17 22)'
            : impact === 'medium'
              ? 'oklch(0.68 0.14 70)'
              : 'oklch(0.6 0.13 162)';

        const pillInk =
          impact === 'high'
            ? 'oklch(0.48 0.15 22)'
            : impact === 'medium'
              ? 'oklch(0.45 0.12 70)'
              : 'oklch(0.4 0.11 162)';

        const pillBg =
          impact === 'high'
            ? 'oklch(0.958 0.026 22)'
            : impact === 'medium'
              ? 'oklch(0.965 0.03 70)'
              : 'oklch(0.955 0.03 162)';

        return (
          <div
            key={e.code}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(240px, 1.5fr) 100px 116px 92px',
              gap: '14px',
              padding: '14px 20px',
              alignItems: 'center',
              ...(index < rules.length - 1 && {
                borderBottom: '1px solid oklch(0.968 0.006 280)',
              }),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0 }}>
              <span
                style={{
                  flex: '0 0 6px',
                  width: '6px',
                  height: '6px',
                  marginTop: '5px',
                  borderRadius: '99px',
                  background: dotColor,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    letterSpacing: '-0.012em',
                    color: 'oklch(0.24 0.015 280)',
                  }}
                >
                  {signalLabel(e.code)}
                </span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    lineHeight: 1.45,
                    color: 'oklch(0.56 0.015 280)',
                    textWrap: 'pretty',
                  }}
                >
                  {signalDescription(e.code)}
                </span>
              </div>
            </div>

            <span
              style={{
                textAlign: 'right',
                fontSize: '13px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: 'oklch(0.2 0.015 280)',
              }}
            >
              {evidenceObserved(e)}
            </span>

            <span
              style={{
                textAlign: 'right',
                fontSize: '12.5px',
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              {evidenceThreshold(e)}
            </span>

            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                justifySelf: 'end',
                padding: '3px 10px',
                borderRadius: 'var(--s-radius-pill)',
                fontSize: '11.5px',
                fontWeight: 600,
                color: pillInk,
                background: pillBg,
              }}
            >
              {titleCase(impact)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WhyFlaggedCard({ it }: { it: IncidentDetail }): React.JSX.Element {
  const mitigating = it.evidence.filter((e) => e.weight < 0);
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
            Why this looks suspicious
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            Warning signs observed within the incident window.
          </p>
        </div>
      </div>

      <p
        style={{
          margin: 0,
          padding: '16px 20px 12px',
          maxWidth: '78ch',
          fontSize: '13px',
          fontWeight: 500,
          lineHeight: 1.65,
          color: 'oklch(0.32 0.015 280)',
          textWrap: 'pretty',
        }}
      >
        {whyText(it)}
      </p>

      <TriggeredRules it={it} />

      {mitigating.length > 0 && (
        <p
          style={{
            margin: 0,
            padding: '12px 20px',
            fontSize: '12px',
            fontWeight: 500,
            color: 'oklch(0.5 0.015 280)',
          }}
        >
          <strong style={{ fontWeight: 600, color: 'oklch(0.3 0.015 280)' }}>
            Argued against flagging:
          </strong>{' '}
          {mitigating.map((e) => signalLabel(e.code)).join(', ')}.
        </p>
      )}
      {it.abstentions.length > 0 && (
        <p
          style={{
            margin: 0,
            padding: '8px 20px 14px',
            fontSize: '12px',
            fontWeight: 500,
            color: 'oklch(0.5 0.015 280)',
          }}
        >
          <strong style={{ fontWeight: 600, color: 'oklch(0.3 0.015 280)' }}>
            Not enough data to judge:
          </strong>{' '}
          {it.abstentions.map((a) => ruleName(a.rule)).join(', ')}.
        </p>
      )}
    </section>
  );
}

function BehaviouralSignalsCard({ it }: { it: IncidentDetail }): React.JSX.Element {
  const rows = behaviourRows(it);
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
            borderRadius: '99px',
            background: 'oklch(0.962 0.024 258)',
          }}
        >
          <Ruler size={16} color="oklch(0.46 0.12 258)" />
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
            What we measured
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
              textWrap: 'pretty',
            }}
          >
            The key numbers behind this incident.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            padding: '16px 20px',
            margin: 0,
            fontSize: '13px',
            fontWeight: 500,
            color: 'oklch(0.56 0.015 280)',
          }}
        >
          No extra measurements are available for this incident.
        </p>
      ) : (
        rows.map((row, index) => (
          <div
            key={row.signal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '14px 20px',
              ...(index < rows.length - 1 && {
                borderBottom: '1px solid oklch(0.968 0.006 280)',
              }),
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 28px',
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                background: 'oklch(0.965 0.004 270)',
              }}
            >
              {row.icon}
            </span>
            <span
              style={{
                flex: '1 1 auto',
                fontSize: '12.5px',
                fontWeight: 500,
                color: 'oklch(0.3 0.015 280)',
              }}
            >
              {row.signal}
            </span>
            <span
              style={{
                flex: '0 0 56px',
                textAlign: 'right',
                fontSize: '14px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: 'oklch(0.2 0.015 280)',
              }}
            >
              {row.observed}
            </span>
            <span
              style={{
                flex: '0 0 152px',
                textAlign: 'right',
                fontSize: '11.5px',
                fontWeight: 500,
                color: 'oklch(0.58 0.015 280)',
              }}
            >
              {row.context}
            </span>
          </div>
        ))
      )}
    </section>
  );
}

export function EvidenceSignalsTab({ it }: { it: IncidentDetail }): React.JSX.Element {
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 1fr)',
        gap: '12px',
        marginBottom: '14px',
        alignItems: 'start',
      }}
    >
      <WhyFlaggedCard it={it} />
      <BehaviouralSignalsCard it={it} />
    </section>
  );
}
