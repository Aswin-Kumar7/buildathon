import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Callout } from '@sentinel/ui';
import {
  policyResponseSchema,
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
import { PolicyHistoryDrawer } from './PolicyHistoryDrawer.js';
import { ENFORCEMENT_KEY, fetchEnforcement } from '../shell/enforcement.js';
import './PolicyPage.css';
import { fetchPolicyVersions as fetchVersions } from '../shared/fetchers.js';

async function fetchPolicy(): Promise<PolicyResponse> {
  const response = await fetch('/api/policy', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return policyResponseSchema.parse(await response.json());
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

type SaveNote = { tone: 'ok' | 'critical'; text: string } | null;

/**
 * The two writes this page can make, and the one note that reports either outcome.
 *
 * Both invalidate the policy and its history on success, so the Active policy card, the header and
 * the history modal all reflect the change without a reload.
 */
function usePolicyWrites(): {
  save: ReturnType<typeof useMutation<PolicyVersion, Error, string>>;
  revert: ReturnType<typeof useMutation<PolicyVersion, Error, string>>;
  saveNote: SaveNote;
  setSaveNote: (note: SaveNote) => void;
} {
  const client = useQueryClient();
  const [saveNote, setSaveNote] = useState<SaveNote>(null);

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['policy-versions'] });
    void client.invalidateQueries({ queryKey: ['policy'] });
  };

  const save = useMutation<PolicyVersion, Error, string>({
    mutationFn: async (yaml) =>
      policyVersionSchema.parse(
        ((await postJson('/api/policy/save', { source: yaml })) as { version: unknown }).version,
      ),
    onSuccess: (saved) => {
      setSaveNote({ tone: 'ok', text: `Policy v${saved.version} is live.` });
      refresh();
    },
    onError: (error) =>
      setSaveNote({ tone: 'critical', text: `The live policy was not changed. ${error.message}` }),
  });

  /** Brings an earlier version back as a new one, the way `git revert` writes history forward. */
  const revert = useMutation<PolicyVersion, Error, string>({
    mutationFn: async (id) =>
      policyVersionSchema.parse(
        ((await postJson(`/api/policy/versions/${id}/revert`)) as { version: unknown }).version,
      ),
    onSuccess: (saved) => {
      setSaveNote({ tone: 'ok', text: `Reverted. Policy v${saved.version} is live.` });
      refresh();
    },
    onError: (error) =>
      setSaveNote({ tone: 'critical', text: `Nothing was reverted. ${error.message}` }),
  });

  return { save, revert, saveNote, setSaveNote };
}

/** Everything derived from the live policy and the working draft, kept out of the component body. */
function useDraftState(
  live: PolicyResponse | undefined,
  draft: PolicyDraft | null,
  versions: PolicyVersion[] | undefined,
): { version: number; allowlistEmpty: boolean; dirty: boolean; clientProblems: string[] } {
  const version = useMemo(
    () =>
      live === undefined
        ? 1
        : nextVersion(
            live.version,
            (versions ?? []).map((v) => v.version),
          ),
    [live, versions],
  );
  return {
    version,
    // The API returns allowlist counts, never the entries, so a draft cannot faithfully carry them.
    allowlistEmpty:
      live !== undefined &&
      live.allowlisted.sessions + live.allowlisted.devices + live.allowlisted.networks === 0,
    dirty: live !== undefined && draft !== null && isDirty(draft, live),
    clientProblems: draft === null ? [] : draftProblems(draft),
  };
}

/** The page's two overlays, kept together so the page body stays a layout rather than a set of gates. */
function PolicyModals({
  historyOpen,
  confirmOpen,
  versions,
  versionsLoading,
  policy,
  reverting,
  version,
  onRevert,
  onCloseHistory,
  onCancelSave,
  onConfirmSave,
}: {
  historyOpen: boolean;
  confirmOpen: boolean;
  versions: PolicyVersion[];
  versionsLoading: boolean;
  policy: PolicyResponse | undefined;
  reverting: boolean;
  version: number;
  onRevert: (id: string) => void;
  onCloseHistory: () => void;
  onCancelSave: () => void;
  onConfirmSave: () => void;
}): React.JSX.Element {
  return (
    <>
      {historyOpen && (
        <PolicyHistoryDrawer
          versions={versions}
          loading={versionsLoading}
          policy={policy}
          reverting={reverting}
          onRevert={onRevert}
          onClose={onCloseHistory}
        />
      )}
      {confirmOpen && (
        <ConfirmSaveDialog version={version} onCancel={onCancelSave} onConfirm={onConfirmSave} />
      )}
    </>
  );
}

export function PolicyPage(): React.JSX.Element {
  const policy = useQuery({ queryKey: ['policy'], queryFn: fetchPolicy });
  const versions = useQuery({ queryKey: ['policy-versions'], queryFn: fetchVersions });

  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const { save, revert, saveNote, setSaveNote } = usePolicyWrites();

  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const updateDraft = (fn: (draft: PolicyDraft) => PolicyDraft): void =>
    setDraft((current) => (current === null ? current : fn(current)));

  const live = policy.data;
  useEffect(() => {
    if (live === undefined) return;
    setDraft((current) =>
      current === null || !isDirty(current, live) ? draftFromPolicy(live) : current,
    );
  }, [live]);

  const { version, allowlistEmpty, dirty, clientProblems } = useDraftState(
    live,
    draft,
    versions.data,
  );

  const simulate = useMutation({
    mutationFn: async (yaml: string) =>
      simulationResponseSchema.parse(await postJson('/api/policy/simulate', { policy: yaml })),
  });
  const yaml = (): string | null =>
    draft === null || live === undefined ? null : buildPolicyYaml(draft, live, version);

  const runPreview = (): void => {
    const source = yaml();
    if (source === null || clientProblems.length > 0) return;
    simulate.mutate(source);
  };

  const canSave = dirty && allowlistEmpty && clientProblems.length === 0;

  /** Opens the confirmation. Nothing is written until it is accepted. */
  const runSave = (): void => {
    if (!canSave) return;
    setSaveNote(null);
    setConfirmOpen(true);
  };

  const confirmSave = (): void => {
    setConfirmOpen(false);
    const source = yaml();
    if (!canSave || source === null) return;
    save.mutate(source);
  };

  return (
    <div className="pol-page">
      <PageBar />

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
              pending={save.isPending || revert.isPending}
              note={saveNote}
              onSave={runSave}
              onViewHistory={() => setHistoryOpen(true)}
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

      <PolicyModals
        historyOpen={historyOpen}
        confirmOpen={confirmOpen && draft !== null && live !== undefined}
        versions={versions.data ?? []}
        versionsLoading={versions.isPending}
        policy={live}
        reverting={revert.isPending}
        version={version}
        onRevert={(id) => revert.mutate(id)}
        onCloseHistory={() => setHistoryOpen(false)}
        onCancelSave={() => setConfirmOpen(false)}
        onConfirmSave={confirmSave}
      />
    </div>
  );
}

/**
 * The one live enforcement indicator on the page. It used to be a hardcoded "Sentinel active" that
 * kept claiming protection was on while the kill switch below it said otherwise; it now reads the
 * same enforcement state the kill switch acts on, so engaging the switch changes it.
 */
function PageBar(): React.JSX.Element {
  const enforcement = useQuery({
    queryKey: ENFORCEMENT_KEY,
    queryFn: fetchEnforcement,
    refetchInterval: 15_000,
  });
  const stopped = enforcement.data?.paused === true;
  const label = enforcement.isPending
    ? 'Checking…'
    : stopped
      ? 'Sentinel stopped'
      : 'Sentinel active';

  return (
    <header className="pol-head">
      <div className="pol-head__left">
        <div className="pol-head__title-row">
          <h1>Policies</h1>
          <span
            className={`pol-head__status-pill${stopped ? ' pol-head__status-pill--stopped' : ''}`}
            role="status"
          >
            <span className="pol-head__status-dot" />
            {label}
          </span>
        </div>
        <p>
          Control how Sentinel protects your business. Saving asks you to confirm, then goes live.
        </p>
      </div>
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

/**
 * The confirmation that replaces the old approval step.
 *
 * A save is now immediate and affects live traffic, so the consequence is stated before anything is
 * written — and the dialog says how to undo it, because reverting is the recovery path that
 * replaced dual control.
 */
function ConfirmSaveDialog({
  version,
  onCancel,
  onConfirm,
}: {
  version: number;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div className="pol-confirm" role="presentation" onClick={onCancel}>
      <div
        className="pol-confirm__box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pol-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="pol-confirm__title" id="pol-confirm-title">
          Make this the live policy?
        </h2>
        <p className="pol-confirm__body">
          Saving publishes <strong>v{version}</strong> and it takes effect immediately — the next
          payment Sentinel sees is judged by these settings. The change is recorded in the audit
          trail, and any earlier version can be brought back from View history.
        </p>
        <div className="pol-confirm__actions">
          <button type="button" className="pol-confirm__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="pol-confirm__go" onClick={onConfirm} autoFocus>
            Save and make live
          </button>
        </div>
      </div>
    </div>
  );
}
