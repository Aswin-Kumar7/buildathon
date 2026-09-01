import { useState } from 'react';
import { Card } from '@sentinel/ui';
import type { IncidentDetail, IncidentGraph } from '@sentinel/contracts';
import './IncidentRelationships.css';
import { WarningCircle, Laptop, CreditCard, Globe, Clock } from '@phosphor-icons/react';

/* ------------------------------------------------------------------------------------------------
 * Relationships tab
 *
 * A backend-only relationship view. Everything here comes from the incident detail payload
 * (GET /incidents/:id): `graph.entity` is the one entity the incident correlated on, `graph.cards`
 * are the distinct cards it touched (fingerprint + network + attempts + captured), `graph.sessions`
 * are the sessions for a network-level case, and `relatedOrders[].sensor` supplies distinct context
 * counts (devices / sessions / networks — as pseudonym fingerprints, never IP / ASN / BIN / last4,
 * none of which the backend has). No relationship is inferred in the frontend.
 * ---------------------------------------------------------------------------------------------- */

type EntityKind = IncidentGraph['entity']['kind'];
type NodeKind = 'incident' | 'device' | 'session' | 'network' | 'card' | 'attempt';

const ENTITY_LABEL: Record<EntityKind, string> = {
  device: 'Device',
  session: 'Session',
  network: 'Network',
};

const incidentRef = (id: string): string => `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

/**
 * The card count shown everywhere in this tab. `distinctCards` is the authoritative count the
 * incident was decided on (the same value the other tabs show); `graph.cards.length` is the fallback
 * when the sketch was unconfirmed. The card *list* is a sample of this count, never a second count.
 */
const cardCount = (it: IncidentDetail): number => it.distinctCards ?? it.graph.cards.length;

function formatWindow(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (minutes < 60) return `${minutes} min ${seconds} sec`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** Distinct count of one sensor fingerprint across the incident's related orders. */
function distinctSensor(
  it: IncidentDetail,
  pick: (s: NonNullable<IncidentDetail['relatedOrders'][number]['sensor']>) => string,
): number {
  const seen = new Set<string>();
  for (const order of it.relatedOrders) {
    if (order.sensor !== null) seen.add(pick(order.sensor));
  }
  return seen.size;
}

type StatusRow = { status: string; count: number; pct: number };
const STATUS_ORDER = ['captured', 'failed', 'authorized', 'refunded', 'created'];
const STATUS_LABEL: Record<string, string> = {
  captured: 'Captured',
  failed: 'Failed',
  authorized: 'Authorized',
  refunded: 'Refunded',
  created: 'Created',
};

/** The status breakdown of the incident's related attempts, or null when none are linked. */
function attemptBreakdown(it: IncidentDetail): { total: number; rows: StatusRow[] } | null {
  const attempts = it.relatedOrders.flatMap((order) => order.attempts);
  if (attempts.length === 0) return null;
  const counts = new Map<string, number>();
  for (const attempt of attempts) counts.set(attempt.status, (counts.get(attempt.status) ?? 0) + 1);
  const total = attempts.length;
  const rows = STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
    status,
    count: counts.get(status)!,
    pct: Math.round((counts.get(status)! / total) * 100),
  }));
  return { total, rows };
}

type ContextNode = { kind: NodeKind; label: string; sub: string };

const ctxNode = (kind: NodeKind, singular: string, count: number, noun: string): ContextNode => ({
  kind,
  label: count === 1 ? singular : `${singular}s`,
  sub: `${count} ${noun}${count === 1 ? '' : 's'}`,
});

/** The single most informative non-primary entity present, for the fourth ("context") node. */
function contextNode(it: IncidentDetail): ContextNode | null {
  const graphSessions = it.graph.sessions.length;
  const networks = distinctSensor(it, (s) => s.ipFingerprint);
  const sessions = distinctSensor(it, (s) => s.sessionFingerprint);
  const devices = distinctSensor(it, (s) => s.deviceFingerprint);
  if (it.entityKind === 'network' && graphSessions > 0)
    return ctxNode('session', 'Session', graphSessions, 'checkout session');
  if (it.entityKind !== 'network' && networks > 0)
    return ctxNode('network', 'Network', networks, 'network fingerprint');
  if (it.entityKind === 'device' && sessions > 0)
    return ctxNode('session', 'Session', sessions, 'session');
  if (it.entityKind !== 'device' && devices > 0)
    return ctxNode('device', 'Device', devices, 'device fingerprint');
  return null;
}

type Insight = { icon: NodeKind; title: string; text: string };
function insights(it: IncidentDetail): Insight[] {
  const out: Insight[] = [];
  const kind = it.entityKind;
  const cards = cardCount(it);
  if (cards > 1) {
    out.push({
      icon: 'card',
      title: `Many cards from one ${kind}`,
      text: `${cards} different cards were tried from the same ${kind}.`,
    });
  }
  const window = formatWindow(it.lastActivityAt - it.firstAttemptAt);
  if (it.attempts > 1) {
    out.push({
      icon: 'attempt',
      title: 'Attempts came in fast',
      text: `${it.attempts} payment attempts in just ${window}.`,
    });
  }
  if (it.attempts > 0 && it.failures > 0) {
    out.push({
      icon: 'incident',
      title: 'Most payments failed',
      text: `${Math.round((it.failures / it.attempts) * 100)}% of these payment attempts failed.`,
    });
  }
  const capturedCards = it.graph.cards.filter((c) => c.captured).length;
  if (capturedCards > 0) {
    out.push({
      icon: 'card',
      title: 'Some payments got through',
      text: `${capturedCards} card${capturedCards === 1 ? '' : 's'} still had a payment go through despite the failures.`,
    });
  }
  out.push({
    icon: 'network',
    title: 'All from the same source',
    text: `Every one of these payment attempts traces back to the same ${kind}.`,
  });
  return out.slice(0, 5);
}

/* ---- small, restrained line icons ---- */
function NodeIcon({ kind }: { kind: NodeKind }): React.JSX.Element {
  switch (kind) {
    case 'incident':
      return <WarningCircle size={16} />;
    case 'device':
      return <Laptop size={16} />;
    case 'card':
      return <CreditCard size={16} />;
    case 'network':
      return <Globe size={16} />;
    case 'session':
      return <Clock size={16} />;
    default:
      return <WarningCircle size={16} />;
  }
}

function StatusDotRow({ row }: { row: StatusRow }): React.JSX.Element {
  return (
    <div className="rg-attempt-row">
      <span className={`rg-status-dot rg-status-dot--${row.status}`} aria-hidden="true" />
      <span className="rg-attempt-row__label">{STATUS_LABEL[row.status] ?? row.status}</span>
      <span className="rg-attempt-row__value">
        {row.count} ({row.pct}%)
      </span>
    </div>
  );
}

function CardsBox({ it, onOpen }: { it: IncidentDetail; onOpen: () => void }): React.JSX.Element {
  const total = cardCount(it);
  const shown = it.graph.cards.slice(0, 4);
  const more = total - shown.length;
  return (
    <button type="button" className="rg-node rg-node--card rg-node--box" onClick={onOpen}>
      <span className="rg-node__head">
        <NodeIcon kind="card" />
        <strong>Cards ({total})</strong>
      </span>
      <span className="rg-node__sub">{total} unique cards</span>
      <span className="rg-card-list">
        {shown.map((card) => (
          <span className="rg-card" key={card.fingerprint}>
            <NodeIcon kind="card" />
            <span className="rg-card__id">
              {card.network !== null ? `${card.network} · ` : ''}
              {card.fingerprint}
            </span>
            <span className="rg-card__meta">
              {card.attempts} attempt{card.attempts === 1 ? '' : 's'} ·{' '}
              {card.captured ? 'captured' : 'no capture'}
            </span>
          </span>
        ))}
        {more > 0 && <span className="rg-card-more">… {more} more</span>}
      </span>
    </button>
  );
}

function AttemptsBox({
  it,
  onOpen,
}: {
  it: IncidentDetail;
  onOpen: () => void;
}): React.JSX.Element {
  const breakdown = attemptBreakdown(it);
  const linked = breakdown?.total ?? 0;
  return (
    <button type="button" className="rg-node rg-node--attempt rg-node--box" onClick={onOpen}>
      <span className="rg-node__head">
        <NodeIcon kind="attempt" />
        <strong>Attempts ({it.attempts})</strong>
      </span>
      <span className="rg-node__sub">
        Within {formatWindow(it.lastActivityAt - it.firstAttemptAt)}
        {breakdown !== null && linked !== it.attempts ? ` · ${linked} resolved` : ''}
      </span>
      {breakdown !== null ? (
        <span className="rg-attempt-list">
          {breakdown.rows.map((row) => (
            <StatusDotRow key={row.status} row={row} />
          ))}
        </span>
      ) : (
        <span className="rg-node__sub">Status breakdown unavailable for this incident.</span>
      )}
    </button>
  );
}

type Selected = { title: string; lines: string[] } | null;

const cardLines = (it: IncidentDetail): string[] =>
  it.graph.cards
    .slice(0, 12)
    .map(
      (c) =>
        `${c.network !== null ? `${c.network} · ` : ''}${c.fingerprint} — ${c.attempts} attempt${c.attempts === 1 ? '' : 's'}, ${c.captured ? 'captured' : 'no capture'}`,
    );

function attemptLines(it: IncidentDetail): string[] {
  const breakdown = attemptBreakdown(it);
  if (breakdown === null) return [`${it.attempts} related attempts`];
  return breakdown.rows.map((r) => `${STATUS_LABEL[r.status] ?? r.status}: ${r.count} (${r.pct}%)`);
}

function EntityNode({
  it,
  onSelect,
}: {
  it: IncidentDetail;
  onSelect: (sel: Selected) => void;
}): React.JSX.Element {
  const kind = it.entityKind;
  const cards = cardCount(it);
  return (
    <button
      type="button"
      className={`rg-node rg-node--${kind}`}
      onClick={() =>
        onSelect({
          title: `${ENTITY_LABEL[kind]} · ${it.graph.entity.fingerprint}`,
          lines: [
            `The ${kind} this incident correlated on`,
            `${cards} distinct card${cards === 1 ? '' : 's'} linked`,
            `${it.attempts} related attempt${it.attempts === 1 ? '' : 's'}`,
            `Window ${formatWindow(it.lastActivityAt - it.firstAttemptAt)}`,
          ],
        })
      }
    >
      <span className="rg-node__head">
        <NodeIcon kind={kind} />
        <strong>{ENTITY_LABEL[kind]} (1)</strong>
      </span>
      <span className="rg-node__sub">{it.graph.entity.fingerprint}</span>
    </button>
  );
}

function IncidentCenter({ it }: { it: IncidentDetail }): React.JSX.Element {
  return (
    <div className={`rg-incident rg-incident--${it.severity}`}>
      <span className="rg-incident__icon" aria-hidden="true">
        <NodeIcon kind="incident" />
      </span>
      <strong className="rg-incident__ref">{incidentRef(it.id)}</strong>
      <span className="rg-incident__risk">Risk: {it.severity}</span>
    </div>
  );
}

function ContextSlot({
  it,
  context,
  onSelect,
}: {
  it: IncidentDetail;
  context: ContextNode;
  onSelect: (sel: Selected) => void;
}): React.JSX.Element {
  return (
    <div className="rg-slot rg-slot--bottom">
      <button
        type="button"
        className={`rg-node rg-node--${context.kind}`}
        onClick={() =>
          onSelect({
            title: context.label,
            lines: [context.sub, `Context of this ${it.entityKind} incident`],
          })
        }
      >
        <span className="rg-node__head">
          <NodeIcon kind={context.kind} />
          <strong>{context.label}</strong>
        </span>
        <span className="rg-node__sub">{context.sub}</span>
      </button>
      <span className="rg-edge-label rg-edge-label--bottom">context</span>
    </div>
  );
}

function GraphCanvas({
  it,
  onSelect,
}: {
  it: IncidentDetail;
  onSelect: (sel: Selected) => void;
}): React.JSX.Element {
  const context = contextNode(it);
  const cards = cardCount(it);
  const hasCards = it.graph.cards.length > 0;

  return (
    <div className="rg-canvas">
      {/* connector lines behind the boxes; fixed anchors keep the star readable and crossing-free */}
      <svg className="rg-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="rg-edge rg-edge--strong" x1="50" y1="50" x2="50" y2="15" />
        {hasCards && <line className="rg-edge rg-edge--strong" x1="50" y1="50" x2="17" y2="50" />}
        {it.attempts > 0 && (
          <line className="rg-edge rg-edge--strong" x1="50" y1="50" x2="83" y2="50" />
        )}
        {context !== null && (
          <line className="rg-edge rg-edge--context" x1="50" y1="50" x2="50" y2="86" />
        )}
      </svg>

      <div className="rg-slot rg-slot--top">
        <EntityNode it={it} onSelect={onSelect} />
        <span className="rg-edge-label rg-edge-label--top">correlated on</span>
      </div>

      {hasCards && (
        <div className="rg-slot rg-slot--left">
          <CardsBox
            it={it}
            onOpen={() => onSelect({ title: `Cards (${cards})`, lines: cardLines(it) })}
          />
          <span className="rg-edge-label rg-edge-label--left">{cards} cards</span>
        </div>
      )}

      <div className="rg-slot rg-slot--center">
        <IncidentCenter it={it} />
      </div>

      {it.attempts > 0 && (
        <div className="rg-slot rg-slot--right">
          <AttemptsBox
            it={it}
            onOpen={() => onSelect({ title: `Attempts (${it.attempts})`, lines: attemptLines(it) })}
          />
          <span className="rg-edge-label rg-edge-label--right">{it.attempts} attempts</span>
        </div>
      )}

      {context !== null && <ContextSlot it={it} context={context} onSelect={onSelect} />}
    </div>
  );
}

function ListView({ it }: { it: IncidentDetail }): React.JSX.Element {
  const context = contextNode(it);
  const breakdown = attemptBreakdown(it);
  const cards = cardCount(it);
  const shownCards = it.graph.cards.slice(0, 8);
  return (
    <div className="rg-list">
      <div className="rg-list__row">
        <NodeIcon kind={it.entityKind} />
        <div>
          <strong>{ENTITY_LABEL[it.entityKind]}</strong>
          <span>{it.graph.entity.fingerprint} — the entity this incident correlated on</span>
        </div>
      </div>
      <div className="rg-list__row">
        <NodeIcon kind="card" />
        <div>
          <strong>Cards ({cards})</strong>
          <span>
            {shownCards
              .map((c) => `${c.network !== null ? `${c.network} · ` : ''}${c.fingerprint}`)
              .join(', ') || 'No cards enumerated'}
            {cards > shownCards.length ? ` … +${cards - shownCards.length}` : ''}
          </span>
        </div>
      </div>
      <div className="rg-list__row">
        <NodeIcon kind="attempt" />
        <div>
          <strong>Attempts ({it.attempts})</strong>
          <span>
            {breakdown
              ? breakdown.rows.map((r) => `${STATUS_LABEL[r.status]} ${r.count}`).join(' · ')
              : 'Status breakdown unavailable'}
          </span>
        </div>
      </div>
      {context !== null && (
        <div className="rg-list__row">
          <NodeIcon kind={context.kind} />
          <div>
            <strong>{context.label}</strong>
            <span>{context.sub}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ it }: { it: IncidentDetail }): React.JSX.Element {
  const context = contextNode(it);
  const present = new Set<NodeKind>(['incident', it.entityKind, 'card', 'attempt']);
  if (context !== null) present.add(context.kind);
  const all: { kind: NodeKind; label: string }[] = [
    { kind: 'incident', label: 'Incident' },
    { kind: 'device', label: 'Device' },
    { kind: 'session', label: 'Session' },
    { kind: 'network', label: 'Network' },
    { kind: 'card', label: 'Card' },
    { kind: 'attempt', label: 'Attempt' },
  ];
  const entries = all.filter((entry) => present.has(entry.kind));
  return (
    <div className="rg-legend">
      {entries.map((entry) => (
        <span className="rg-legend__item" key={entry.kind}>
          <span className={`rg-legend__dot rg-legend__dot--${entry.kind}`} aria-hidden="true" />
          {entry.label}
        </span>
      ))}
      <span className="rg-legend__sep" aria-hidden="true" />
      <span className="rg-legend__item">
        <span className="rg-legend__line rg-legend__line--strong" aria-hidden="true" />
        Strong relationship
      </span>
      {context !== null && (
        <span className="rg-legend__item">
          <span className="rg-legend__line rg-legend__line--context" aria-hidden="true" />
          Context relationship
        </span>
      )}
    </div>
  );
}

function GraphControls({
  view,
  onView,
  onZoom,
}: {
  view: 'graph' | 'list';
  onView: (v: 'graph' | 'list') => void;
  onZoom: (fn: (z: number) => number) => void;
}): React.JSX.Element {
  return (
    <div className="rg-controls">
      {view === 'graph' && (
        <div className="rg-zoom">
          <button type="button" onClick={() => onZoom(() => 1)} title="Fit to view">
            Fit
          </button>
          <button
            type="button"
            onClick={() => onZoom((z) => Math.max(0.6, z - 0.15))}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => onZoom((z) => Math.min(1.6, z + 0.15))}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      )}
      <div className="rg-toggle" role="tablist" aria-label="Graph or list view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'graph'}
          className={view === 'graph' ? 'is-active' : undefined}
          onClick={() => onView('graph')}
        >
          Graph
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'list'}
          className={view === 'list' ? 'is-active' : undefined}
          onClick={() => onView('list')}
        >
          List
        </button>
      </div>
    </div>
  );
}

function RelationshipGraph({ it }: { it: IncidentDetail }): React.JSX.Element {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<Selected>(null);

  return (
    <Card
      title="Relationship graph"
      subtitle="How the payments and cards in this incident are connected"
      actions={<GraphControls view={view} onView={setView} onZoom={setZoom} />}
    >
      <div className="rg-viewport">
        {view === 'graph' ? (
          <div className="rg-scale" style={{ transform: `scale(${zoom})` }}>
            <GraphCanvas it={it} onSelect={setSelected} />
          </div>
        ) : (
          <ListView it={it} />
        )}
        {selected !== null && (
          <div className="rg-popover" role="dialog" aria-label={selected.title}>
            <div className="rg-popover__head">
              <strong>{selected.title}</strong>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close">
                ×
              </button>
            </div>
            <ul>
              {selected.lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <Legend it={it} />
    </Card>
  );
}

function RelationshipInsights({ it }: { it: IncidentDetail }): React.JSX.Element {
  const items = insights(it);
  return (
    <Card
      title="What is connected"
      subtitle="The links Sentinel found between these payment attempts."
    >
      <ul className="rg-insights">
        {items.map((item) => (
          <li key={item.title}>
            <span className={`rg-insight__icon rg-insight__icon--${item.icon}`} aria-hidden="true">
              <NodeIcon kind={item.icon} />
            </span>
            <span className="rg-insight__text">
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="rg-info" role="note">
        <span className="rg-info__icon" aria-hidden="true">
          i
        </span>
        <p>
          This map shows the payment attempts Sentinel connected to this incident, and how they’re
          linked. Select any item to see its activity.
        </p>
      </div>
    </Card>
  );
}

export function RelationshipsTab({ it }: { it: IncidentDetail }): React.JSX.Element {
  return (
    <div className="rg">
      <div className="rg-grid">
        <RelationshipGraph it={it} />
        <RelationshipInsights it={it} />
      </div>
    </div>
  );
}
