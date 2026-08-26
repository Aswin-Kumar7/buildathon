import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, PageHeader } from '@sentinel/ui';
import {
  auditListResponseSchema,
  auditVerifyResponseSchema,
  type AuditEntry,
  type AuditVerifyResponse,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { kindLabel, payloadSummary, reasonText } from '../incidents/audit-words.js';
import './AuditPage.css';

async function fetchEntries(): Promise<AuditEntry[]> {
  const response = await fetch('/api/audit', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditListResponseSchema.parse(await response.json()).entries;
}

function ChainTable({ entries }: { entries: AuditEntry[] }): React.JSX.Element {
  return (
    <div className="audit-table-wrap">
      <table className="audit-table">
        <thead>
          <tr>
            <th>#</th>
            <th>When</th>
            <th>What</th>
            <th>By</th>
            <th>Detail</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.seq}>
              <td>{entry.seq}</td>
              <td>{new Date(entry.at).toLocaleString()}</td>
              <td>
                <Badge tone="neutral">{kindLabel(entry.kind)}</Badge>
              </td>
              <td>{entry.actor ?? 'system'}</td>
              <td className="audit-detail">{payloadSummary(entry.payload)}</td>
              <td>
                <code>{entry.hash.slice(0, 10)}…</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VerifyResult({ result }: { result: AuditVerifyResponse }): React.JSX.Element {
  if (result.valid) {
    return (
      <Callout tone="ok" title="The chain is intact">
        <p>
          All {result.entries} entries link back to the one before them, unbroken. Head hash{' '}
          <code>{result.head?.slice(0, 16)}…</code> — this is the value an external anchor would pin
          to make even a full rewrite detectable.
        </p>
      </Callout>
    );
  }

  const d = result.firstDivergence!;
  return (
    <Callout tone="critical" title={`The record has been altered at entry ${d.seq}`}>
      <p role="alert">
        {reasonText(d.reason)}. Nothing at or after sequence {d.seq} can be trusted. The chain is
        built precisely so this cannot pass unnoticed.
      </p>
    </Callout>
  );
}

export function AuditPage(): React.JSX.Element {
  const entries = useQuery({ queryKey: ['audit'], queryFn: fetchEntries, refetchInterval: 20_000 });

  const verify = useMutation({
    mutationFn: async (): Promise<AuditVerifyResponse> => {
      const response = await fetch('/api/audit/verify', {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders(),
      });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      return auditVerifyResponseSchema.parse(await response.json());
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Govern"
        title="Audit trail"
        description="Every decision and every hand that touched one, in a hash-linked chain. You cannot quietly change a past entry: doing so breaks the link the next one recorded, and the verifier walks the whole chain and reports the first place the arithmetic stops adding up."
      />

      <Card>
        <div className="incident-bar">
          <Button variant="ghost" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? 'Walking the chain…' : 'Verify chain'}
          </Button>
          <span className="incident__band">
            Also runnable from the command line as <code>pnpm audit:verify</code>.
          </span>
        </div>
        {verify.isError && <p role="alert">{verify.error.message}</p>}
        {verify.data !== undefined && <VerifyResult result={verify.data} />}
      </Card>

      {entries.isError && (
        <Callout tone="critical" title="Could not load the audit log">
          <p role="alert">{entries.error.message}</p>
        </Callout>
      )}
      {entries.isPending && <p role="status">Loading the chain…</p>}

      {entries.data !== undefined && entries.data.length === 0 && (
        <Callout tone="neutral" title="Nothing recorded yet">
          <p>Move an incident or take an action, and it appears here, chained.</p>
        </Callout>
      )}

      {entries.data !== undefined && entries.data.length > 0 && (
        <ChainTable entries={entries.data} />
      )}
    </>
  );
}
