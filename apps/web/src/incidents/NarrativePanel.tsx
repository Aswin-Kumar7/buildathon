import { useQuery } from '@tanstack/react-query';
import { Badge, Card } from '@sentinel/ui';
import { narrativeResponseSchema, type NarrationSourceDto } from '@sentinel/contracts';

async function fetchNarrative(id: string) {
  const response = await fetch(`/api/incidents/${id}/narrative`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return narrativeResponseSchema.parse(await response.json()).narrative;
}

// What each tier is, in a word, and how loudly to say it. The badge is the point: a reader should
// always know whether a sentence came from a model or from the deterministic floor.
const SOURCE: Record<NarrationSourceDto, { label: string; tone: 'ok' | 'neutral' | 'warn' }> = {
  live: { label: 'live model', tone: 'ok' },
  local: { label: 'on-device', tone: 'neutral' },
  replay: { label: 'replayed', tone: 'warn' },
  template: { label: 'template', tone: 'neutral' },
};

const SOURCE_NOTE: Record<NarrationSourceDto, string> = {
  live: 'written by the remote model, which chose which facts to state — never their values.',
  local: 'assembled on-device with no network, from the same facts.',
  replay: 'reproduced from a recorded live run — identical words, no network touched.',
  template: 'the deterministic floor: every applicable fact, in a fixed order, no model involved.',
};

/**
 * The plain-English account of an incident — and, on every line, where the words came from.
 *
 * The values in these sentences are bound from the evidence in the API; a model, when one is used,
 * only chose which claims to make and in what order. The source badge makes the degradation visible:
 * when the live narrator is unreachable the badge changes and the account does not, because the
 * sentences were never the model's to write.
 */
export function NarrativePanel({ incidentId }: { incidentId: string }): React.JSX.Element {
  const narrative = useQuery({
    queryKey: ['narrative', incidentId],
    queryFn: () => fetchNarrative(incidentId),
  });

  return (
    <Card>
      <div className="incident__head">
        <h2>What happened, in words</h2>
        {narrative.data !== undefined && (
          <Badge tone={SOURCE[narrative.data.source].tone}>
            {SOURCE[narrative.data.source].label}
          </Badge>
        )}
      </div>

      {narrative.isPending && <p role="status">Composing…</p>}
      {narrative.isError && (
        <p role="alert" className="incident__band">
          Could not compose a narrative: {narrative.error.message}
        </p>
      )}

      {narrative.data !== undefined && (
        <>
          <p className="incident__band">{SOURCE_NOTE[narrative.data.source]}</p>
          <ul className="narrative">
            {narrative.data.lines.map((line) => (
              <li key={line.claimId} className="narrative__line">
                <span className="narrative__text">{line.text}</span>
                <span className={`narrative__badge narrative__badge--${line.source}`}>
                  {SOURCE[line.source].label}
                </span>
              </li>
            ))}
          </ul>

          <p className="incident__meta-note">
            {narrative.data.lines.length} claim{narrative.data.lines.length === 1 ? '' : 's'} from
            evidence <code>{narrative.data.evidenceHash.slice(0, 8)}</code>
            {narrative.data.dropped > 0 && (
              <>
                {' · '}
                <strong>{narrative.data.dropped}</strong> dropped by the fact guard
              </>
            )}
            {narrative.data.source !== narrative.data.mode && (
              <> · asked for {SOURCE[narrative.data.mode].label}, degraded to this</>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
