import { useQuery } from '@tanstack/react-query';
import { Callout, Card } from '@sentinel/ui';
import { auditListResponseSchema, type AuditEntry } from '@sentinel/contracts';
import { kindLabel, payloadSummary } from './audit-words.js';

async function fetchTrail(incidentId: string): Promise<AuditEntry[]> {
  const response = await fetch(`/api/audit?incidentId=${incidentId}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditListResponseSchema.parse(await response.json()).entries;
}

/**
 * The chained record for one incident: its transitions and the actions taken on it.
 *
 * The same events appear in the incident history and the containment panel above; this is the
 * copy that cannot be edited after the fact, and it shows the hash so a reader can see it is a
 * chain rather than just another list.
 */
export function AuditTrail({ incidentId }: { incidentId: string }): React.JSX.Element {
  const trail = useQuery({
    queryKey: ['audit', 'incident', incidentId],
    queryFn: () => fetchTrail(incidentId),
  });

  if (trail.isPending) return <p role="status">Loading the audit trail…</p>;
  if (trail.isError) {
    return (
      <Callout tone="critical" title="Could not load the audit trail">
        <p role="alert">{trail.error.message}</p>
      </Callout>
    );
  }

  return (
    <Card>
      <h2>Audit trail</h2>
      {trail.data.length === 0 ? (
        <p>Nothing has been recorded against this incident yet.</p>
      ) : (
        <ol className="history">
          {trail.data.map((entry) => (
            <li key={entry.seq}>
              <strong>
                #{entry.seq} {kindLabel(entry.kind)}
              </strong>{' '}
              by {entry.actor ?? 'the system'} at {new Date(entry.at).toLocaleString()}
              {payloadSummary(entry.payload) !== '' && <> — {payloadSummary(entry.payload)}</>}{' '}
              <code>{entry.hash.slice(0, 8)}…</code>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
