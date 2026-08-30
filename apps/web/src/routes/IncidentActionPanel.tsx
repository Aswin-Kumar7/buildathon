import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { IncidentDetail } from '@sentinel/contracts';
import { AiRecommendationCard, TakeActionModal } from './ActionsAiCard.js';
import {
  PendingApproval,
  TERMINAL,
  queryState,
  useActionMutations,
  useActionsData,
} from './IncidentActionsAudit.js';

/**
 * The AI recommendation and its take-action flow, as a self-contained panel so the merchant can act
 * from the incident Overview — not two clicks away. It shares the Actions tab's queries/mutations by
 * key, so acting here and viewing there stay in lock-step, and the accept still only *proposes* a
 * containment: nothing is applied until it is approved.
 */
export function IncidentActionPanel({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const client = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const id = incident.id;

  const { recommendation, containments } = useActionsData(id);
  const { accept, approve, reject } = useActionMutations(id, client, () => setModalOpen(false));

  const live = (containments.data ?? []).find(
    (c) => c.status === 'proposed' || c.status === 'active',
  );
  const terminal = TERMINAL.has(incident.status);

  return (
    <>
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
    </>
  );
}
