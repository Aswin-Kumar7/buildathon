import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Callout, Card } from '@sentinel/ui';
import {
  containmentListResponseSchema,
  type ContainmentDto,
  type PolicyDecisionDto,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { actionLabel, decisionCode, rupees } from './policy-words.js';

async function fetchContainments(incidentId: string): Promise<ContainmentDto[]> {
  const response = await fetch(`/api/containments?incidentId=${incidentId}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return containmentListResponseSchema.parse(await response.json()).containments;
}

const STATUS_TONE = {
  proposed: 'warn',
  active: 'critical',
  rejected: 'neutral',
  expired: 'neutral',
  released: 'ok',
} as const;

/**
 * What the policy decided, and what it refused to do.
 *
 * The refusals are the more interesting half and are shown as prominently. An analyst looking at
 * an incident nothing happened to needs to know *which rule* held it back — "no action" on its
 * own is indistinguishable from a system that is not working.
 */
function Decision({ decision }: { decision: PolicyDecisionDto }): React.JSX.Element {
  return (
    <>
      <dl className="incident__facts">
        <div>
          <dt>Proposed</dt>
          <dd>{actionLabel(decision.action)}</dd>
        </div>
        <div>
          <dt>Approvals needed</dt>
          <dd>{decision.approvalsRequired === 0 ? 'none' : decision.approvalsRequired}</dd>
        </div>
        <div>
          <dt>Expires after</dt>
          <dd>
            {decision.expiresAfterMinutes === null
              ? 'does not expire'
              : `${decision.expiresAfterMinutes} minutes`}
          </dd>
        </div>
        <div>
          <dt>Policy</dt>
          <dd>
            v{decision.policyVersion} <code>{decision.policyHash}</code>
          </dd>
        </div>
      </dl>

      {/* Never averaged into one number: that would hide which way the asymmetry runs, and the
          asymmetry is the only thing about it worth knowing. */}
      <h3>What being wrong would cost</h3>
      <dl className="compare__cost">
        <div>
          <dt>If we act and it was legitimate</dt>
          <dd>{rupees(decision.expectedCost.ifWeAct)}</dd>
        </div>
        <div>
          <dt>If we wait and it was an attack</dt>
          <dd>{rupees(decision.expectedCost.ifWeWait)}</dd>
        </div>
      </dl>
      <p className="incident__band">
        Order-of-magnitude estimates from the cost figures declared in <code>policy.yaml</code>, not
        measurements.
      </p>

      {decision.refusals.length > 0 && (
        <>
          <h3>What the policy would not allow</h3>
          <ul className="abstentions">
            {decision.refusals.map((code) => (
              <li key={code}>{decisionCode(code)}</li>
            ))}
          </ul>
        </>
      )}

      {decision.reasons.length > 0 && (
        <ul className="abstentions">
          {decision.reasons.map((code) => (
            <li key={code}>{decisionCode(code)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Existing({
  containment,
  onAct,
  pending,
}: {
  containment: ContainmentDto;
  onAct: (verb: string, minutes?: number) => void;
  pending: boolean;
}): React.JSX.Element {
  const open = containment.status === 'proposed';
  const active = containment.status === 'active';

  return (
    <Card>
      <header className="incident__head">
        <div>
          <Badge tone={STATUS_TONE[containment.status]}>{containment.status}</Badge>{' '}
          <Badge tone="neutral">{actionLabel(containment.action)}</Badge>
        </div>
        {containment.expiresAt !== null && containment.status === 'active' && (
          <span className="incident__band">
            expires {new Date(containment.expiresAt).toLocaleTimeString()}
          </span>
        )}
      </header>

      <Decision decision={containment.decision} />

      <h3>Who has agreed</h3>
      <p className="incident__band">
        {containment.approvals.length} of {containment.approvalsRequired}
        {containment.approvals.length > 0 && ` — ${containment.approvals.join(', ')}`}
      </p>

      <ol className="history">
        {containment.history.map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            <strong>{entry.kind}</strong> by {entry.actor ?? 'the system'} at{' '}
            {new Date(entry.at).toLocaleString()}
            {entry.note !== null && <> — {entry.note}</>}
          </li>
        ))}
      </ol>

      {/* An enumerated set, never free-form. Every one of them writes an audit line. */}
      <div className="incident-bar">
        {open && (
          <>
            <Button variant="ghost" onClick={() => onAct('approve')} disabled={pending}>
              Approve
            </Button>
            <Button variant="ghost" onClick={() => onAct('reject')} disabled={pending}>
              Reject
            </Button>
          </>
        )}
        {active && (
          <>
            <Button variant="ghost" onClick={() => onAct('extend', 15)} disabled={pending}>
              Extend 15 minutes
            </Button>
            <Button variant="ghost" onClick={() => onAct('release')} disabled={pending}>
              Release now
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function Past({ containment }: { containment: ContainmentDto }): React.JSX.Element {
  return (
    <Card>
      <header className="incident__head">
        <Badge tone={STATUS_TONE[containment.status]}>{containment.status}</Badge>
        <span className="incident__band">{actionLabel(containment.action)}</span>
      </header>
      <ol className="history">
        {containment.history.map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            <strong>{entry.kind}</strong> by {entry.actor ?? 'the system'}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Nothing({ onAsk, pending }: { onAsk: () => void; pending: boolean }): React.JSX.Element {
  return (
    <Card>
      <h2>Action</h2>
      <p>
        Nothing has been proposed for this incident. Asking the policy records what it decided —
        including a refusal, which is the answer worth having.
      </p>
      <Button variant="ghost" onClick={onAsk} disabled={pending}>
        {pending ? 'Asking the policy…' : 'Ask the policy'}
      </Button>
    </Card>
  );
}

export function ContainmentPanel({ incidentId }: { incidentId: string }): React.JSX.Element {
  const client = useQueryClient();
  const containments = useQuery({
    queryKey: ['containments', incidentId],
    queryFn: () => fetchContainments(incidentId),
  });

  const send = useMutation({
    mutationFn: async ({ path, minutes }: { path: string; minutes?: number }) => {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(minutes === undefined ? {} : { minutes }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `api returned ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['containments', incidentId] }),
  });

  if (containments.isPending) return <p role="status">Loading actions…</p>;

  if (containments.isError) {
    return (
      <Callout tone="critical" title="Could not load actions">
        <p role="alert">{containments.error.message}</p>
      </Callout>
    );
  }

  const live = containments.data.find((c) => c.status === 'proposed' || c.status === 'active');

  return (
    <>
      {send.isError && (
        <Callout tone="critical" title="That did not work">
          <p role="alert">{send.error.message}</p>
        </Callout>
      )}

      {live === undefined ? (
        <Nothing
          pending={send.isPending}
          onAsk={() => send.mutate({ path: `/api/incidents/${incidentId}/propose` })}
        />
      ) : (
        <Existing
          containment={live}
          pending={send.isPending}
          onAct={(verb, minutes) =>
            send.mutate({
              path: `/api/containments/${live.id}/${verb}`,
              ...(minutes !== undefined && { minutes }),
            })
          }
        />
      )}

      {containments.data
        .filter((c) => c !== live)
        .map((past) => (
          <Past key={past.id} containment={past} />
        ))}
    </>
  );
}
