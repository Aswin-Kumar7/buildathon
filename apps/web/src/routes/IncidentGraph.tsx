import type { IncidentGraph } from '@sentinel/contracts';
import './IncidentGraph.css';

const ENTITY_LABEL: Record<IncidentGraph['entity']['kind'], string> = {
  session: 'Session',
  device: 'Device',
  network: 'Network',
};

const MAX_NODES = 28;

/**
 * The correlation an incident rests on, drawn: the entity at the centre with an edge to every
 * distinct card it touched, each card coloured by whether any payment on it got through. This is the
 * "one device, many cards" shape of card testing made visible — and every label is a short
 * fingerprint of a pseudonym, never a real card.
 */
export function IncidentGraphView({ graph }: { graph: IncidentGraph }): React.JSX.Element {
  const cards = graph.cards;
  const shown = cards.slice(0, MAX_NODES);
  const cx = 170;
  const cy = 140;
  const radius = shown.length <= 3 ? 70 : 108;

  const nodes = shown.map((card, index) => {
    const angle = (index / Math.max(shown.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { card, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const captured = cards.filter((card) => card.captured).length;

  if (cards.length === 0) {
    return (
      <p className="detail-note">No confirmed cards are linked to this entity in the window.</p>
    );
  }

  return (
    <div className="ig">
      <svg
        viewBox="0 0 340 280"
        role="img"
        aria-label={`${graph.entity.kind} linked to ${cards.length} distinct cards`}
      >
        {nodes.map((node, index) => (
          <line
            key={`edge-${index}`}
            className="ig__edge"
            x1={cx}
            y1={cy}
            x2={node.x}
            y2={node.y}
          />
        ))}
        {nodes.map((node, index) => (
          <circle
            key={`card-${index}`}
            className={`ig__card ig__card--${node.card.captured ? 'captured' : 'failed'}`}
            cx={node.x}
            cy={node.y}
            r={10}
          >
            <title>
              {`${node.card.network ?? 'card'} · ${node.card.fingerprint} — ${node.card.attempts} attempt${
                node.card.attempts === 1 ? '' : 's'
              }${node.card.captured ? ', captured' : ', all failed'}`}
            </title>
          </circle>
        ))}
        <circle className="ig__entity-ring" cx={cx} cy={cy} r={32} />
        <text className="ig__entity-kind" x={cx} y={cy - 4} textAnchor="middle">
          {ENTITY_LABEL[graph.entity.kind]}
        </text>
        <text className="ig__entity-fp" x={cx} y={cy + 11} textAnchor="middle">
          {graph.entity.fingerprint}
        </text>
      </svg>
      <p className="ig__caption">
        One {graph.entity.kind} touched <strong>{cards.length}</strong> distinct card
        {cards.length === 1 ? '' : 's'}
        {captured > 0 ? `, ${captured} captured` : ', none captured'}
        {graph.entity.kind === 'network' && graph.sessions.length > 0
          ? ` · across ${graph.sessions.length} session${graph.sessions.length === 1 ? '' : 's'}`
          : ''}
        {cards.length > shown.length ? ` · showing ${shown.length}` : ''}
      </p>
    </div>
  );
}
