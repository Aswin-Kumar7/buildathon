import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { IncidentDetail, IncidentGraph } from '@sentinel/contracts';
import './IncidentRelationships.css';
import {
  WarningCircle,
  Laptop,
  CreditCard,
  Globe,
  Clock,
  GitFork,
  LinkSimple,
  Lightning,
  ListDashes,
  X,
} from '@phosphor-icons/react';
import { formatWindow } from '../shared/time.js';

type EntityKind = IncidentGraph['entity']['kind'];
type NodeKind = 'incident' | 'device' | 'session' | 'network' | 'card' | 'attempt';

const ENTITY_LABEL: Record<EntityKind, string> = {
  device: 'Device',
  session: 'Session',
  network: 'Network',
};

const incidentRef = (id: string): string => `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

const cardCount = (it: IncidentDetail): number => it.distinctCards ?? it.graph.cards.length;

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

/* Sentinel Console standard design system OKLCH icon colors */
function NodeIcon({ kind }: { kind: NodeKind }): React.JSX.Element {
  switch (kind) {
    case 'incident':
      return <WarningCircle size={15} color="oklch(0.45 0.16 22)" />;
    case 'device':
      return <Laptop size={15} color="oklch(0.46 0.12 258)" />;
    case 'card':
      return <CreditCard size={15} color="oklch(0.4 0.11 162)" />;
    case 'network':
      return <Globe size={15} color="oklch(0.45 0.12 85)" />;
    case 'session':
      return <Clock size={15} color="oklch(0.45 0.12 85)" />;
    default:
      return <WarningCircle size={15} color="oklch(0.45 0.16 22)" />;
  }
}

type Selected = { title: string; lines: string[] } | null;

type Edge = { id: string; d: string; dashed: boolean };

/**
 * An edge between two nodes, measured rather than assumed.
 *
 * These paths used to be literal coordinates — `M 180,65 C 250,65 260,190 320,190` and a stack of
 * siblings each 58px further down. Nothing held the layout to those numbers: the cards are laid out
 * by flexbox, so a card whose label wrapped, a different card count, or any container width other
 * than the one the numbers were written for left the lines ending in empty space beside the nodes
 * they were supposed to join.
 *
 * So the geometry is read back from the DOM. Each edge starts on the edge of the source node facing
 * the hub and ends on the hub's circumference, which is why they meet the circle cleanly instead of
 * stopping at its bounding box.
 */
function edgeTo(
  box: DOMRect,
  from: DOMRect,
  hub: DOMRect,
  side: 'left' | 'right' | 'top' | 'bottom',
): string {
  const cx = hub.left + hub.width / 2 - box.left;
  const cy = hub.top + hub.height / 2 - box.top;
  const radius = hub.width / 2;

  const horizontal = side === 'left' || side === 'right';
  const x1 =
    (side === 'left' ? from.right : side === 'right' ? from.left : from.left + from.width / 2) -
    box.left;
  const y1 =
    (side === 'top' ? from.bottom : side === 'bottom' ? from.top : from.top + from.height / 2) -
    box.top;

  // Stop on the circle itself, on the bearing the source sits at.
  const angle = Math.atan2(y1 - cy, x1 - cx);
  const x2 = cx + Math.cos(angle) * radius;
  const y2 = cy + Math.sin(angle) * radius;

  if (!horizontal) return `M ${x1} ${y1} L ${x2} ${y2}`;

  // A horizontal S-curve: control points level with each end, so the line leaves the card and meets
  // the circle flat rather than at an angle.
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

const cardLines = (it: IncidentDetail): string[] =>
  it.graph.cards.map(
    (c) =>
      `${c.network !== null ? `${c.network} · ` : ''}${c.fingerprint} — ${c.attempts} attempt${c.attempts === 1 ? '' : 's'}, ${c.captured ? 'captured' : 'no capture'}`,
  );

function attemptLines(it: IncidentDetail): string[] {
  const breakdown = attemptBreakdown(it);
  if (breakdown === null) return [`${it.attempts} related attempts`];
  return breakdown.rows.map((r) => `${STATUS_LABEL[r.status] ?? r.status}: ${r.count} (${r.pct}%)`);
}

function FormatCardLabel(fingerprint: string): string {
  if (!fingerprint) return '•••';
  const clean = fingerprint.trim();
  if (clean.length <= 4) return `••• ${clean}`;
  return `••• ${clean.slice(-4)}`;
}

function GraphCanvas({
  it,
  onSelect,
}: {
  it: IncidentDetail;
  onSelect: (sel: Selected) => void;
}): React.JSX.Element {
  const context = contextNode(it);
  const totalCards = cardCount(it);
  const shownCards = it.graph.cards.slice(0, 4);
  const moreCards = totalCards - shownCards.length;
  const breakdown = attemptBreakdown(it);
  const windowStr = formatWindow(it.lastActivityAt - it.firstAttemptAt);

  const boxRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const topRef = useRef<HTMLButtonElement>(null);
  const bottomRef = useRef<HTMLButtonElement>(null);
  const attemptRef = useRef<HTMLButtonElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);

  const measure = useCallback((): void => {
    const box = boxRef.current?.getBoundingClientRect();
    const hub = hubRef.current?.getBoundingClientRect();
    if (box === undefined || hub === undefined) return;

    const next: Edge[] = [];
    cardRefs.current.forEach((node, index) => {
      if (node === null) return;
      next.push({
        id: `card-${index}`,
        d: edgeTo(box, node.getBoundingClientRect(), hub, 'left'),
        dashed: false,
      });
    });
    if (topRef.current !== null) {
      next.push({
        id: 'entity',
        d: edgeTo(box, topRef.current.getBoundingClientRect(), hub, 'top'),
        dashed: false,
      });
    }
    if (bottomRef.current !== null) {
      next.push({
        id: 'context',
        d: edgeTo(box, bottomRef.current.getBoundingClientRect(), hub, 'bottom'),
        dashed: true,
      });
    }
    if (attemptRef.current !== null) {
      next.push({
        id: 'attempts',
        d: edgeTo(box, attemptRef.current.getBoundingClientRect(), hub, 'right'),
        dashed: false,
      });
    }
    // Bail out when nothing moved. Every measurement builds a fresh array, so setting state
    // unconditionally re-rendered, which re-ran the effect, which measured again — React caught it
    // as an update-depth overflow rather than letting it spin forever.
    setEdges((previous) =>
      previous.length === next.length && previous.every((edge, i) => edge.d === next[i]!.d)
        ? previous
        : next,
    );
  }, []);

  // Re-measured whenever anything can have moved: the container resizing, a card's label wrapping,
  // or the node list itself changing. Layout effect so the edges are drawn in the same frame as the
  // nodes and never flash in the wrong place.
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (boxRef.current !== null) observer.observe(boxRef.current);
    for (const node of cardRefs.current) if (node !== null) observer.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
    // `context` is rebuilt on every render, so depending on the object itself re-ran this effect
    // forever; what actually changes the graph is whether that node exists at all.
  }, [measure, shownCards.length, moreCards, context !== null, it.attempts]);

  return (
    <div
      ref={boxRef}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '380px',
        background: 'oklch(0.995 0.002 270)',
        borderRadius: '10px',
        border: '1px solid oklch(0.94 0.006 280)',
        padding: '24px 20px',
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, 180px) 1fr minmax(140px, 190px)',
        alignItems: 'center',
        gap: '16px',
      }}
    >
      {/* SVG Connecting Edges */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
        aria-hidden="true"
      >
        {edges.map((edge) => (
          <path
            key={edge.id}
            d={edge.d}
            stroke={edge.dashed ? 'oklch(0.82 0.006 280)' : 'oklch(0.88 0.006 280)'}
            strokeWidth="1.5"
            strokeDasharray={edge.dashed ? '4 3' : undefined}
            fill="none"
          />
        ))}
      </svg>

      {/* Left Column: Cards Stack */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 2,
        }}
      >
        {totalCards > 0 && <span style={{ display: 'none' }}>Cards ({totalCards})</span>}
        {shownCards.map((c, index) => (
          <button
            key={c.fingerprint}
            type="button"
            ref={(node) => {
              cardRefs.current[index] = node;
            }}
            onClick={() => onSelect({ title: `Cards (${totalCards})`, lines: cardLines(it) })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'oklch(1 0 0)',
              border: '1px solid oklch(0.91 0.006 280)',
              boxShadow: '0 1px 3px rgba(13, 21, 38, 0.03)',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
              transition: 'transform 0.12s ease',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                background: 'oklch(0.955 0.03 162)',
                flex: '0 0 26px',
              }}
            >
              <CreditCard size={15} color="oklch(0.4 0.11 162)" />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'oklch(0.24 0.015 280)',
                  fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Card {FormatCardLabel(c.fingerprint)}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 500, color: 'oklch(0.56 0.015 280)' }}>
                {c.attempts} attempt{c.attempts === 1 ? '' : 's'}
              </span>
            </div>
          </button>
        ))}

        {moreCards > 0 && (
          <button
            type="button"
            ref={(node) => {
              cardRefs.current[shownCards.length] = node;
            }}
            onClick={() => onSelect({ title: `Cards (${totalCards})`, lines: cardLines(it) })}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--s-radius-pill)',
              fontSize: '11.5px',
              fontWeight: 600,
              color: 'oklch(0.42 0.015 280)',
              background: 'oklch(0.96 0.006 280)',
              border: '1px solid oklch(0.91 0.006 280)',
              cursor: 'pointer',
              width: 'fit-content',
            }}
          >
            + {moreCards} more cards
          </button>
        )}
      </div>

      {/* Center Column: Top Node, Center Incident Circle, Bottom Context Node */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '100%',
          minHeight: '340px',
          zIndex: 2,
        }}
      >
        {/* Top Node (Correlated Entity) */}
        <button
          type="button"
          ref={topRef}
          onClick={() =>
            onSelect({
              title: `${ENTITY_LABEL[it.entityKind]} · ${it.graph.entity.fingerprint}`,
              lines: [
                `The ${it.entityKind} this incident correlated on`,
                `${totalCards} distinct card${totalCards === 1 ? '' : 's'} linked`,
                `${it.attempts} related attempt${it.attempts === 1 ? '' : 's'}`,
                `Window ${windowStr}`,
              ],
            })
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 14px',
            borderRadius: '8px',
            background: 'oklch(1 0 0)',
            border: '1px solid oklch(0.91 0.006 280)',
            boxShadow: '0 1px 3px rgba(13, 21, 38, 0.03)',
            cursor: 'pointer',
          }}
        >
          <NodeIcon kind={it.entityKind} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
              {ENTITY_LABEL[it.entityKind]} (1)
            </span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {it.graph.entity.fingerprint.slice(0, 8)}
            </span>
          </div>
        </button>

        {/* Center Node (Incident Circle) */}
        <div
          ref={hubRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '94px',
            height: '94px',
            borderRadius: '50%',
            border:
              it.severity === 'high'
                ? '2px solid oklch(0.85 0.08 22)'
                : '2px solid oklch(0.88 0.07 85)',
            background: it.severity === 'high' ? 'oklch(0.96 0.02 18)' : 'oklch(0.96 0.03 85)',
            boxShadow: '0 2px 8px rgba(13, 21, 38, 0.04)',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: '12.5px',
              fontWeight: 650,
              letterSpacing: '-0.01em',
              color: it.severity === 'high' ? 'oklch(0.38 0.14 22)' : 'oklch(0.4 0.12 85)',
            }}
          >
            {incidentRef(it.id)}
          </span>
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 500,
              color: it.severity === 'high' ? 'oklch(0.45 0.16 22)' : 'oklch(0.45 0.12 85)',
            }}
          >
            Risk: {it.severity.charAt(0).toUpperCase() + it.severity.slice(1)}
          </span>
        </div>

        {/* Bottom Node (Context Node) */}
        {context !== null ? (
          <button
            type="button"
            ref={bottomRef}
            onClick={() =>
              onSelect({
                title: context.label,
                lines: [context.sub, `Context of this ${it.entityKind} incident`],
              })
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '7px 14px',
              borderRadius: '8px',
              background: 'oklch(1 0 0)',
              border: '1px solid oklch(0.91 0.006 280)',
              boxShadow: '0 1px 3px rgba(13, 21, 38, 0.03)',
              cursor: 'pointer',
            }}
          >
            <NodeIcon kind={context.kind} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
                {context.label}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 500, color: 'oklch(0.56 0.015 280)' }}>
                {context.sub}
              </span>
            </div>
          </button>
        ) : (
          <div style={{ height: '34px' }} />
        )}
      </div>

      {/* Right Column: Attempts Box */}
      <div style={{ zIndex: 2, justifySelf: 'end', width: '100%' }}>
        {it.attempts > 0 && (
          <button
            type="button"
            ref={attemptRef}
            onClick={() =>
              onSelect({ title: `Attempts (${it.attempts})`, lines: attemptLines(it) })
            }
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: '10px',
              background: 'oklch(1 0 0)',
              border: '1px solid oklch(0.91 0.006 280)',
              boxShadow: '0 1px 3px rgba(13, 21, 38, 0.03)',
              cursor: 'pointer',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ListDashes size={15} color="oklch(0.46 0.12 258)" />
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  color: 'oklch(0.21 0.015 280)',
                }}
              >
                Attempts ({it.attempts})
              </span>
            </div>

            {breakdown !== null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {breakdown.rows.map((row) => (
                  <div
                    key={row.status}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background:
                            row.status === 'captured'
                              ? 'oklch(0.4 0.11 162)'
                              : row.status === 'failed'
                                ? 'oklch(0.45 0.16 22)'
                                : 'oklch(0.45 0.12 85)',
                        }}
                      />
                      <span style={{ fontWeight: 500, color: 'oklch(0.44 0.015 280)' }}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        color: 'oklch(0.24 0.015 280)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              All within {windowStr}
              {breakdown !== null && breakdown.total !== it.attempts
                ? ` · ${breakdown.total} resolved`
                : ''}
            </span>
          </button>
        )}
      </div>
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
  const all: { kind: NodeKind; label: string; color: string }[] = [
    { kind: 'incident', label: 'Incident', color: 'oklch(0.45 0.16 22)' },
    { kind: 'session', label: 'Session', color: 'oklch(0.44 0.015 280)' },
    { kind: 'network', label: 'Network', color: 'oklch(0.45 0.12 85)' },
    { kind: 'card', label: 'Card', color: 'oklch(0.4 0.11 162)' },
    { kind: 'attempt', label: 'Attempt', color: 'oklch(0.46 0.12 258)' },
  ];
  const entries = all.filter((entry) => present.has(entry.kind));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
        fontSize: '12px',
        fontWeight: 500,
        color: 'oklch(0.44 0.015 280)',
      }}
    >
      {entries.map((entry) => (
        <div key={entry.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: entry.color,
            }}
          />
          <span>{entry.label}</span>
        </div>
      ))}
    </div>
  );
}

function GraphControls({
  view,
  onView,
}: {
  view: 'graph' | 'list';
  onView: (v: 'graph' | 'list') => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'inline-flex',
        borderRadius: '6px',
        background: 'oklch(0.962 0.006 280)',
        padding: '2px',
        border: '1px solid oklch(0.925 0.006 280)',
      }}
      role="tablist"
      aria-label="Graph or list view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === 'graph'}
        onClick={() => onView('graph')}
        style={{
          padding: '4px 12px',
          borderRadius: '4px',
          fontSize: '11.5px',
          fontWeight: 600,
          border: 'none',
          cursor: 'pointer',
          background: view === 'graph' ? 'oklch(1 0 0)' : 'transparent',
          color: view === 'graph' ? 'oklch(0.21 0.015 280)' : 'oklch(0.56 0.015 280)',
          boxShadow: view === 'graph' ? '0 1px 2px rgba(0, 0, 0, 0.06)' : 'none',
        }}
      >
        Graph
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === 'list'}
        onClick={() => onView('list')}
        style={{
          padding: '4px 12px',
          borderRadius: '4px',
          fontSize: '11.5px',
          fontWeight: 600,
          border: 'none',
          cursor: 'pointer',
          background: view === 'list' ? 'oklch(1 0 0)' : 'transparent',
          color: view === 'list' ? 'oklch(0.21 0.015 280)' : 'oklch(0.56 0.015 280)',
          boxShadow: view === 'list' ? '0 1px 2px rgba(0, 0, 0, 0.06)' : 'none',
        }}
      >
        List
      </button>
    </div>
  );
}

function RelationshipGraph({ it }: { it: IncidentDetail }): React.JSX.Element {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [selected, setSelected] = useState<Selected>(null);

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
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
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
            <GitFork size={16} color="oklch(0.46 0.12 258)" />
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
              Relationship graph
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              How the payments and cards in this incident are connected.
            </p>
          </div>
        </div>

        <GraphControls view={view} onView={setView} />
      </div>

      <div style={{ position: 'relative', padding: '16px 20px' }}>
        {view === 'graph' ? <GraphCanvas it={it} onSelect={setSelected} /> : <ListView it={it} />}

        {selected !== null && (
          <div
            style={{
              position: 'absolute',
              top: '24px',
              right: '28px',
              zIndex: 10,
              width: '240px',
              padding: '12px 14px',
              borderRadius: '10px',
              background: '#FFFFFF',
              border: '1px solid oklch(0.92 0.006 280)',
              boxShadow: '0 4px 16px rgba(13, 21, 38, 0.08)',
            }}
            role="dialog"
            aria-label={selected.title}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <strong style={{ fontSize: '13px', color: 'oklch(0.21 0.015 280)' }}>
                {selected.title}
              </strong>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'inline-flex',
                }}
              >
                <X size={14} color="oklch(0.56 0.015 280)" />
              </button>
            </div>
            {/* Thirty-eight cards will not fit a panel this size, and the list was simply
                overflowing past it. It scrolls now, capped so the panel stays inside the canvas. */}
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                maxHeight: '260px',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
              }}
            >
              {selected.lines.map((line, index) => (
                <li key={index} style={{ fontSize: '11.5px', color: 'oklch(0.5 0.015 280)' }}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 16px' }}>
        <Legend it={it} />
      </div>
    </section>
  );
}

function RelationshipInsights({ it }: { it: IncidentDetail }): React.JSX.Element {
  const items = insights(it);

  const getInsightIcon = (kind: NodeKind) => {
    switch (kind) {
      case 'card':
        return <CreditCard size={15} color="oklch(0.4 0.11 162)" />;
      case 'attempt':
        return <Lightning size={15} color="oklch(0.46 0.12 258)" />;
      case 'incident':
        return <WarningCircle size={15} color="oklch(0.45 0.16 22)" />;
      default:
        return <Globe size={15} color="oklch(0.45 0.12 85)" />;
    }
  };

  const getInsightBg = (kind: NodeKind) => {
    switch (kind) {
      case 'card':
        return 'oklch(0.955 0.03 162)';
      case 'attempt':
        return 'oklch(0.962 0.024 258)';
      case 'incident':
        return 'oklch(0.96 0.02 18)';
      case 'network':
        return 'oklch(0.96 0.03 85)';
      case 'session':
        return 'oklch(0.96 0.03 85)';
      default:
        return 'oklch(0.962 0.006 280)';
    }
  };

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
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
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
          <LinkSimple size={16} color="oklch(0.46 0.12 258)" />
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
            What is connected
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.56 0.015 280)',
            }}
          >
            The links Sentinel found between these payment attempts.
          </p>
        </div>
      </div>

      {/* Insights List */}
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {items.map((item) => (
          <div
            key={item.title}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              paddingBottom: '12px',
              borderBottom: '1px solid oklch(0.96 0.006 280)',
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
                borderRadius: '7px',
                background: getInsightBg(item.icon),
                marginTop: '1px',
              }}
            >
              {getInsightIcon(item.icon)}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <strong style={{ fontSize: '13px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
                {item.title}
              </strong>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'oklch(0.56 0.015 280)',
                  lineHeight: 1.45,
                }}
              >
                {item.text}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RelationshipsTab({ it }: { it: IncidentDetail }): React.JSX.Element {
  return (
    <div className="rg">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
          gap: '12px',
          alignItems: 'start',
        }}
      >
        <RelationshipGraph it={it} />
        <RelationshipInsights it={it} />
      </div>
    </div>
  );
}
