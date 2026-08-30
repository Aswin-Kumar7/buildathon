import { Card } from '@sentinel/ui';
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
import './IncidentEvidence.css';

/* ------------------------------------------------------------------------------------------------
 * Evidence & signals tab
 *
 * A merchant-readable, rules-only view of why the detector opened this incident. Every value comes
 * from the incident detail payload (GET /incidents/:id): the triggered rules and their observed /
 * threshold numbers are `evidence[]`; the impact tier is a presentation of each rule's real signed
 * weight; the behavioural signals are the incident's own counts, graph and (when a rule fired) the
 * observed value it carried. The ML model is deliberately absent here — it has its own tab.
 * ---------------------------------------------------------------------------------------------- */

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

function formatWindow(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (minutes < 60) return `${minutes} min ${seconds} sec`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function whyText(it: IncidentDetail): string {
  const count = it.firedRules.length;
  const window = formatWindow(it.lastActivityAt - it.firstAttemptAt);
  const lead =
    count === 0
      ? `We reviewed the payment activity in this incident over ${window}`
      : `${count} warning ${count === 1 ? 'sign' : 'signs'} showed up in this incident within ${window}`;
  return `${lead}. Together they point to ${hypothesisName(it.primaryHypothesis).toLowerCase()}, and Sentinel’s recommendation is to ${decisionLabel(it.recommendedDecision).toLowerCase()}.`;
}

type BehaviourRow = { signal: string; observed: string; context: string };

function behaviourRows(it: IncidentDetail): (BehaviourRow & { icon: React.JSX.Element })[] {
  const rows: (BehaviourRow & { icon: React.JSX.Element })[] = [];
  const cards = it.distinctCards ?? (it.graph.cards.length > 0 ? it.graph.cards.length : null);
  if (cards !== null) {
    rows.push({
      signal: 'Different cards',
      observed: `${cards}`,
      context: `linked to this ${it.entityKind}`,
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <rect x={3} y={6} width={18} height={12} rx={2} />
          <path d="M3 10h18M7 14h.01" />
        </svg>
      ),
    });
  }
  if (it.attempts > 0) {
    rows.push({
      signal: 'Attempts',
      observed: `${it.attempts}`,
      context: `over ${formatWindow(it.lastActivityAt - it.firstAttemptAt)}`,
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-18v8l4 4" />
        </svg>
      ),
    });
    rows.push({
      signal: 'Failed attempts',
      observed: `${it.failures}`,
      context: `${Math.round((it.failures / it.attempts) * 100)}% of attempts`,
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm-3-11l6 6m0-6l-6 6" />
        </svg>
      ),
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
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      ),
    });
  }
  if (it.entityKind === 'network' && it.graph.sessions.length > 0) {
    rows.push({
      signal: 'Sessions involved',
      observed: `${it.graph.sessions.length}`,
      context: 'checkout sessions on this network',
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <path d="M21 12c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9 9-4.03 9-9zM3 12h18M12 3v18M12 3c3.31 0 6 4.03 6 9s-2.69 9-6 9-6-4.03-6-9 2.69-9 6-9z" />
        </svg>
      ),
    });
  }
  const velocity = it.evidence.find((e) => e.code === 'attempt_rate_above_threshold');
  if (velocity !== undefined) {
    rows.push({
      signal: 'Peak attempt rate',
      observed: evidenceObserved(velocity),
      context: `fires past ${evidenceThreshold(velocity)}`,
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
    });
  }
  const cadence = it.evidence.find((e) => e.code === 'inter_arrival_variation_low');
  if (cadence !== undefined) {
    rows.push({
      signal: 'Timing regularity',
      observed: cadence.observed.toFixed(2),
      context: 'lower is more machine-like',
      icon: (
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          width={18}
          height={18}
        >
          <path d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
      ),
    });
  }
  return rows;
}

function TriggeredRules({ it }: { it: IncidentDetail }): React.JSX.Element {
  const rules = it.evidence.filter((e) => e.weight > 0).sort((a, b) => b.weight - a.weight);
  if (rules.length === 0) {
    return <p className="es-empty">No unusual patterns stood out on the last check.</p>;
  }
  return (
    <div className="es-table-wrap">
      <table className="es-rules">
        <thead>
          <tr>
            <th>What we saw</th>
            <th>Observed</th>
            <th>Expected limit</th>
            <th>Concern</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((e) => {
            const impact = evidenceImpact(e.weight);
            return (
              <tr key={e.code}>
                <td className="es-rule">
                  <span className={`es-rule__dot es-rule__dot--${impact}`} aria-hidden="true" />
                  <span className="es-rule__text">
                    <strong>{signalLabel(e.code)}</strong>
                    <span>{signalDescription(e.code)}</span>
                  </span>
                </td>
                <td className="es-observed">{evidenceObserved(e)}</td>
                <td className="es-threshold">{evidenceThreshold(e)}</td>
                <td>
                  <span className={`es-impact es-impact--${impact}`}>{titleCase(impact)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WhyFlaggedCard({ it }: { it: IncidentDetail }): React.JSX.Element {
  const mitigating = it.evidence.filter((e) => e.weight < 0);
  return (
    <Card title="Why this looks suspicious">
      <p className="es-why">{whyText(it)}</p>

      <TriggeredRules it={it} />

      {mitigating.length > 0 && (
        <p className="es-note">
          <strong>Argued against flagging:</strong>{' '}
          {mitigating.map((e) => signalLabel(e.code)).join(', ')}.
        </p>
      )}
      {it.abstentions.length > 0 && (
        <p className="es-note">
          <strong>Not enough data to judge:</strong>{' '}
          {it.abstentions.map((a) => ruleName(a.rule)).join(', ')}.
        </p>
      )}
    </Card>
  );
}

function BehaviouralSignalsCard({ it }: { it: IncidentDetail }): React.JSX.Element {
  const rows = behaviourRows(it);
  return (
    <Card title="What we measured" subtitle="The key numbers behind this incident.">
      {rows.length === 0 ? (
        <p className="es-empty">No extra measurements are available for this incident.</p>
      ) : (
        <div className="es-table-wrap">
          <table className="es-behaviour">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Observed value</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.signal}>
                  <td className="es-behaviour__name">
                    <span className="es-icon-wrap">{row.icon}</span>
                    {row.signal}
                  </td>
                  <td className="es-behaviour__value">{row.observed}</td>
                  <td className="es-behaviour__ctx">{row.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function EvidenceSignalsTab({ it }: { it: IncidentDetail }): React.JSX.Element {
  return (
    <div className="es">
      <div className="es-grid">
        <div className="es-col">
          <WhyFlaggedCard it={it} />
        </div>
        <div className="es-col">
          <BehaviouralSignalsCard it={it} />
        </div>
      </div>
    </div>
  );
}
