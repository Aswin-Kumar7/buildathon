import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  auditListResponseSchema,
  containmentListResponseSchema,
  riskAcceptResponseSchema,
  riskRecommendationResponseSchema,
  type AuditEntry,
  type ContainmentDto,
  type IncidentDetail,
  type RiskAction,
  type RiskRecommendation,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import { kindLabel, payloadSummary } from '../incidents/audit-words.js';
import { AiRecommendationCard, TakeActionModal } from './ActionsAiCard.js';
import { ActionHistory, AuditLog } from './ActionsHistoryAudit.js';
import './IncidentActionsAudit.css';

async function get<T>(path: string, parse: (raw: unknown) => T): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return parse(await response.json());
}

export const TERMINAL: ReadonlySet<IncidentDetail['status']> = new Set(['resolved', 'expired']);

/**
 * Incident → Actions & audit.
 *
 * The AI Risk Manager's recommendation and the merchant's controls on the left; the tamper-evident
 * audit log on the right. Every value comes from the backend — the recommendation from the reasoning
 * layer (ids resolved to bound text server-side), the action history from real containment and
 * transition records, the audit log from the chained ledger. Nothing here is authored on the client.
 */
export function ActionsAuditTab({
  incident,
  onResolve,
  resolvePending,
  resolveError,
}: {
  incident: IncidentDetail;
  onResolve: (verdict: 'confirmed_abuse' | 'false_positive') => void;
  resolvePending: boolean;
  resolveError: string | null;
}): React.JSX.Element {
  const client = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const id = incident.id;

  const { recommendation, containments, audit } = useActionsData(id);
  const { accept, approve, reject } = useActionMutations(id, client, () => setModalOpen(false));

  const live = (containments.data ?? []).find(
    (c) => c.status === 'proposed' || c.status === 'active',
  );
  const terminal = TERMINAL.has(incident.status);

  return (
    <div className="aa">
      <div className="aa-main">
        <AiRecommendationCard
          state={queryState(recommendation)}
          recommendation={recommendation.data ?? null}
          terminal={terminal}
          hasLiveContainment={live !== undefined}
          onTakeAction={() => setModalOpen(true)}
        />
        <PendingApproval
          containment={live?.status === 'proposed' ? live : undefined}
          approve={approve}
          reject={reject}
        />
      </div>
      <div className="aa-side">
        <AuditLog state={queryState(audit)} entries={audit.data ?? []} />
        <ActionHistory
          incident={incident}
          containments={containments.data ?? []}
          resolvable={!terminal}
          onResolve={onResolve}
          resolvePending={resolvePending}
          resolveError={resolveError}
        />
      </div>

      {modalOpen && recommendation.data !== null && recommendation.data !== undefined && (
        <TakeActionModal
          recommendation={recommendation.data}
          hasLiveContainment={live !== undefined}
          pending={accept.isPending}
          error={accept.isError ? accept.error.message : null}
          onConfirm={() => accept.mutate(recommendation.data!.groundingHash)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

export function PendingApproval({
  containment,
  approve,
  reject,
}: {
  containment: ContainmentDto | undefined;
  approve: { mutate: (id: string) => void; isPending: boolean };
  reject: { mutate: (id: string) => void; isPending: boolean };
}): React.JSX.Element | null {
  if (containment === undefined) return null;
  const pending = approve.isPending || reject.isPending;
  const need = containment.approvalsRequired;
  const have = containment.approvals.length;
  return (
    <div className="aa-pending">
      <div className="aa-pending__text">
        <strong>Sentinel has proposed an action and needs your approval.</strong>
        <span>
          {have} of {need} approval{need === 1 ? '' : 's'} given · nothing is applied until it’s
          approved.
        </span>
      </div>
      <div className="aa-pending__actions">
        <button
          type="button"
          className="aa-btn aa-btn--ghost"
          disabled={pending}
          onClick={() => reject.mutate(containment.id)}
        >
          Reject
        </button>
        <button
          type="button"
          className="aa-btn aa-btn--primary"
          disabled={pending}
          onClick={() => approve.mutate(containment.id)}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

export function useActionsData(id: string) {
  return {
    recommendation: useQuery({
      queryKey: ['recommendation', id],
      queryFn: () =>
        get(
          `/api/incidents/${id}/recommendation`,
          (raw) => riskRecommendationResponseSchema.parse(raw).recommendation,
        ),
    }),
    containments: useQuery({
      queryKey: ['containments', id],
      queryFn: () =>
        get(
          `/api/containments?incidentId=${id}`,
          (raw) => containmentListResponseSchema.parse(raw).containments,
        ),
    }),
    audit: useQuery({
      queryKey: ['audit', 'incident', id],
      queryFn: () =>
        get(`/api/audit?incidentId=${id}`, (raw) => auditListResponseSchema.parse(raw).entries),
    }),
  };
}

export function useActionMutations(
  id: string,
  client: ReturnType<typeof useQueryClient>,
  onAcceptDone: () => void,
) {
  const refresh = (): void => {
    const keys = [
      ['recommendation', id],
      ['containments', id],
      ['audit', 'incident', id],
      ['incident', id],
      ['incidents'],
    ];
    for (const queryKey of keys) void client.invalidateQueries({ queryKey });
  };
  const accept = useMutation({
    mutationFn: (hash: string) =>
      post(`/api/incidents/${id}/recommendation/accept`, { groundingHash: hash }, (raw) =>
        riskAcceptResponseSchema.parse(raw),
      ),
    onSuccess: () => {
      onAcceptDone();
      refresh();
    },
  });
  const approve = useMutation({
    mutationFn: (cid: string) => post(`/api/containments/${cid}/approve`, {}, (raw) => raw),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: (cid: string) => post(`/api/containments/${cid}/reject`, {}, (raw) => raw),
    onSuccess: refresh,
  });
  return { accept, approve, reject };
}

async function post<T>(path: string, body: unknown, parse: (raw: unknown) => T): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `api returned ${response.status}`);
  }
  return parse(await response.json());
}

export type QueryState = 'pending' | 'error' | 'ready';
export function queryState(q: { isPending: boolean; isError: boolean }): QueryState {
  return q.isPending ? 'pending' : q.isError ? 'error' : 'ready';
}

export type { RiskAction, RiskRecommendation, AuditEntry };
export { kindLabel, payloadSummary };
