import { useEffect, useMemo, useState } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Callout } from '@sentinel/ui';
import {
  policyResponseSchema,
  policyVersionListResponseSchema,
  policyVersionSchema,
  simulationResponseSchema,
  type PolicyResponse,
  type PolicyVersion,
} from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';
import {
  buildPolicyYaml,
  draftFromPolicy,
  draftProblems,
  isDirty,
  nextVersion,
  type PolicyDraft,
} from './policy-draft.js';
import { ActivePolicyCard } from './PolicyActive.js';
import { EnforcementCard } from './PolicyEnforcement.js';
import { PolicySettingsCard } from './PolicySettings.js';
import { PolicyPreviewCard } from './PolicyPreview.js';
import { HistoryModal } from './PolicyHistory.js';
import './PolicyPage.css';

async function fetchPolicy(): Promise<PolicyResponse> {
  const response = await fetch('/api/policy', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return policyResponseSchema.parse(await response.json());
}

async function fetchVersions(): Promise<PolicyVersion[]> {
  const response = await fetch('/api/policy/versions', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return policyVersionListResponseSchema.parse(await response.json()).versions;
}

async function postJson(path: string, body?: unknown): Promise<unknown> {
  const response = await apiMutate(path, body);
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: unknown };
    const message = Array.isArray(detail.message)
      ? detail.message.join('; ')
      : typeof detail.message === 'string'
        ? detail.message
        : `api returned ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

export function PolicyPage(): React.JSX.Element {
  const client = useQueryClient();
  const policy = useQuery({ queryKey: ['policy'], queryFn: fetchPolicy });
  const versions = useQuery({ queryKey: ['policy-versions'], queryFn: fetchVersions });

  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveNote, setSaveNote] = useState<{ tone: 'ok' | 'critical'; text: string } | null>(null);

  const updateDraft = (fn: (draft: PolicyDraft) => PolicyDraft): void =>
    setDraft((current) => (current === null ? current : fn(current)));

  const live = policy.data;
  useEffect(() => {
    if (live === undefined) return;
    setDraft((current) =>
      current === null || !isDirty(current, live) ? draftFromPolicy(live) : current,
    );
  }, [live]);

  const version = useMemo(
    () =>
      live === undefined
        ? 1
        : nextVersion(
            live.version,
            (versions.data ?? []).map((v) => v.version),
          ),
    [live, versions.data],
  );
  const allowlistEmpty =
    live !== undefined &&
    live.allowlisted.sessions + live.allowlisted.devices + live.allowlisted.networks === 0;
  const dirty = live !== undefined && draft !== null && isDirty(draft, live);
  const clientProblems = draft === null ? [] : draftProblems(draft);

  const simulate = useMutation({
    mutationFn: async (yaml: string) =>
      simulationResponseSchema.parse(await postJson('/api/policy/simulate', { policy: yaml })),
  });
  const save = useMutation({
    mutationFn: async ({ yaml, submit }: { yaml: string; submit: boolean }) => {
      const created = policyVersionSchema.parse(
        ((await postJson('/api/policy/drafts', { source: yaml })) as { version: unknown }).version,
      );
      if (submit) await postJson(`/api/policy/versions/${created.id}/submit`);
      return created;
    },
    onSuccess: (_v, { submit }) => {
      setSaveNote({
        tone: 'ok',
        text: submit
          ? 'Draft created and sent for approval. The live policy is unchanged until it is published.'
          : 'Draft saved. The live policy is unchanged until this draft is approved and published.',
      });
      void client.invalidateQueries({ queryKey: ['policy-versions'] });
    },
    onError: (error: Error) =>
      setSaveNote({ tone: 'critical', text: `The live policy was not changed. ${error.message}` }),
  });

  const runPreview = (): void => {
    if (draft === null || live === undefined || clientProblems.length > 0) return;
    simulate.mutate(buildPolicyYaml(draft, live, version));
  };
  const runSave = (submit: boolean): void => {
    if (
      draft === null ||
      live === undefined ||
      !dirty ||
      !allowlistEmpty ||
      clientProblems.length > 0
    )
      return;
    setSaveNote(null);
    save.mutate({ yaml: buildPolicyYaml(draft, live, version), submit });
  };

  return (
    <div className="pol-page">
      <PageBar onHistory={() => setHistoryOpen(true)} />

      <EnforcementCard />

      {policy.isError && (
        <Callout tone="critical" title="Could not load the policy">
          <p role="alert">{policy.error.message}</p>
        </Callout>
      )}

      {policy.isPending && <PolicySkeleton />}

      {live !== undefined && draft !== null && (
        <div className="pol-grid">
          {/* Column 1: Policy Settings */}
          <div className="pol-grid__col-left">
            <PolicySettingsCard
              draft={draft}
              onDraft={updateDraft}
              problems={clientProblems}
              policy={live}
              version={version}
              dirty={dirty}
              allowlistEmpty={allowlistEmpty}
              pending={save.isPending}
              note={saveNote}
              onSave={runSave}
            />
          </div>

          {/* Column 2: Active Policy & Preview Impact */}
          <div className="pol-grid__col-right">
            <ActivePolicyCard policy={live} versions={versions.data ?? []} />
            <PolicyPreviewCard
              onPreview={runPreview}
              pending={simulate.isPending}
              result={simulate.data}
              error={simulate.error ? simulate.error.message : null}
              blocked={clientProblems.length > 0}
              dirty={dirty}
            />
          </div>
        </div>
      )}

      {historyOpen && (
        <HistoryModal
          versions={versions.data ?? []}
          loading={versions.isPending}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

function PageBar({ onHistory }: { onHistory: () => void }): React.JSX.Element {
  return (
    <header className="pol-head">
      <div className="pol-head__left">
        <div className="pol-head__title-row">
          <h1>Policies</h1>
          <span className="pol-head__status-pill">
            <span className="pol-head__status-dot" />
            Sentinel active
          </span>
        </div>
        <p>Control how Sentinel protects your business. Changes are reviewed before you save.</p>
      </div>
      <button type="button" className="pol-head__history-btn" onClick={onHistory}>
        <ClockCounterClockwise size={14} /> View history
      </button>
    </header>
  );
}

function PolicySkeleton(): React.JSX.Element {
  return (
    <div className="pol-skel" aria-hidden="true">
      <div className="pol-skel__bar" />
      <div className="pol-grid">
        <div className="pol-skel__block" />
        <div className="pol-skel__block pol-skel__block--sm" />
      </div>
    </div>
  );
}
