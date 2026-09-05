import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  ingestionMetricsSchema,
  modelRegistryResponseSchema,
  notificationPrefsSchema,
  workspaceResponseSchema,
  type IngestionMetrics,
  type ModelRegistryResponse,
  type NotificationPrefs,
  type NotifySeverity,
  type WorkspaceResponse,
} from '@sentinel/contracts';
import {
  SESSION_KEY,
  useConfirmedLogout,
  useSession,
  type ConfirmedLogout,
} from '../auth/useSession.js';
import { apiMutate } from '../auth/api.js';
import { NOTIFY_PREFS_KEY } from '../shell/NotificationBell.js';
import { Toggle } from './policy-ui.js';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import {
  User,
  Cpu,
  Bell,
  ShieldCheck,
  Buildings,
  LockSimple,
  SignOut,
  Info,
  Trash,
} from '@phosphor-icons/react';
import './SettingsPage.css';

/**
 * Settings.
 *
 * One column of panels beside a sticky section rail. Every value shown is read from the API — the
 * workspace, the model registry, the ingestion metrics and the notification preferences — and the
 * read-only panels say plainly that they describe the environment rather than offering a control
 * that does not exist.
 */

async function getJson<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return parse(await response.json());
}
const fetchWorkspace = (): Promise<WorkspaceResponse> =>
  getJson('/api/workspace', (v) => workspaceResponseSchema.parse(v));
const fetchRegistry = (): Promise<ModelRegistryResponse> =>
  getJson('/api/model/registry', (v) => modelRegistryResponseSchema.parse(v));
const fetchMetrics = (): Promise<IngestionMetrics> =>
  getJson('/api/ingestion/metrics', (v) => ingestionMetricsSchema.parse(v));
const fetchNotifyPrefs = (): Promise<NotificationPrefs> =>
  getJson('/api/notifications/prefs', (v) => notificationPrefsSchema.parse(v));

async function postMutation(path: string, body: unknown): Promise<void> {
  const response = await apiMutate(path, body);
  if (!response.ok)
    throw new Error(
      ((await response.json().catch(() => ({}))) as { message?: string }).message ??
        `api returned ${response.status}`,
    );
}

const SEVERITY_OPTIONS: { value: NotifySeverity; label: string }[] = [
  { value: 'low', label: 'All incidents' },
  { value: 'medium', label: 'Medium and high severity' },
  { value: 'high', label: 'High severity only' },
];

function ago(iso: string | null): string {
  if (iso === null) return 'No deliveries yet';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

type ProfileDraft = { displayName: string; role: 'analyst' | 'admin' };

/** The panel shell every section wears, so they cannot drift apart. */
function Panel({
  id,
  icon,
  title,
  sub,
  children,
  foot,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="set-panel" id={id} aria-labelledby={`${id}-title`}>
      <header className="set-panel__head">
        <h2 className="set-panel__title" id={`${id}-title`}>
          {icon}
          {title}
        </h2>
        <p className="set-panel__sub">{sub}</p>
      </header>
      <div className="set-panel__main">
        <div className="set-panel__body">{children}</div>
        {foot !== undefined && <div className="set-panel__foot">{foot}</div>}
      </div>
    </section>
  );
}

/** An editable field: its label above a control that uses the full width of the card. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="set-field">
      <span className="set-field__label">{label}</span>
      {children}
      {hint !== undefined && <span className="set-field__hint">{hint}</span>}
    </div>
  );
}

/** A switch or a choice: what it does on the left, the control on the right. */
function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="set-row">
      <div className="set-row__text">
        <span className="set-row__label">{label}</span>
        {hint !== undefined && <span className="set-row__hint">{hint}</span>}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="set-note">
      <Info size={13} />
      <span>{children}</span>
    </p>
  );
}

/**
 * Two columns that mean something.
 *
 * A vertical section rail sat beside the console's own sidebar and read as a sidebar inside a
 * sidebar. The split is now by what you can do with a panel: the left column is everything you can
 * change, the right is what this environment already is and cannot be edited from here. That is a
 * real distinction rather than a decorative one, and it needs no second navigation.
 */
export function SettingsPage(): React.JSX.Element {
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: fetchWorkspace });
  const registry = useQuery({ queryKey: ['model-registry'], queryFn: fetchRegistry });
  const metrics = useQuery({ queryKey: ['ingestion-metrics'], queryFn: fetchMetrics });

  return (
    <div className="set-page">
      <header className="set-head">
        <div>
          <h1>Settings</h1>
          <p>Your profile, what raises the bell, the models in use, and what is connected.</p>
        </div>
        <div className="set-head__badges">
          <span className="set-env">
            <span className="set-env__dot" aria-hidden="true" />
            {workspace.data?.environment ?? 'development'}
          </span>
          <span className="set-mode">
            {workspace.data?.liveMode === true ? 'Live mode' : 'Test mode'}
          </span>
        </div>
      </header>

      <div className="set-body">
        <div className="set-col">
          <h2 className="set-col__cap">What you can change</h2>
          <AccountSection />
          <NotificationsSection />
          <DataSection retentionDays={workspace.data?.retentionDays ?? null} />
        </div>

        <div className="set-col">
          <h2 className="set-col__cap">This environment</h2>
          <AiModelSection ai={workspace.data?.ai ?? null} registry={registry.data} />
          <IntegrationsSection workspace={workspace.data} metrics={metrics.data} />
          <WorkspaceSummaryCard workspace={workspace.data} />
        </div>
      </div>
    </div>
  );
}

/** The profile card's footer: save, sign out, and whatever the last save had to say. */
function ProfileActions({
  dirty,
  save,
  logout,
}: {
  dirty: boolean;
  save: UseMutationResult<unknown, Error, void, unknown>;
  logout: ConfirmedLogout;
}): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="set-btn set-btn--primary"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>
      <button
        type="button"
        className={`set-btn${logout.armed ? ' set-btn--danger' : ''}`}
        onClick={logout.press}
        onBlur={logout.cancel}
        disabled={logout.isPending}
      >
        <SignOut size={14} /> {logout.armed ? 'Press again to sign out' : 'Sign out'}
      </button>
      {save.isSuccess && !dirty && <span className="set-msg set-msg--ok">Saved</span>}
      {save.isError && <span className="set-msg set-msg--bad">{save.error.message}</span>}
    </>
  );
}

function AccountSection(): React.JSX.Element {
  const { user } = useSession();
  const client = useQueryClient();
  const logout = useConfirmedLogout();
  const [draft, setDraft] = useState<ProfileDraft | null>(null);

  useEffect(() => {
    if (user !== null && draft === null)
      setDraft({ displayName: user.displayName, role: user.role });
  }, [user, draft]);

  const save = useMutation({
    mutationFn: () => postMutation('/api/auth/profile', draft),
    onSuccess: () => void client.invalidateQueries({ queryKey: SESSION_KEY }),
  });

  if (user === null || draft === null) {
    return (
      <Panel id="profile" icon={<User size={15} />} title="Your profile" sub="Loading…">
        <p className="set-row__hint">Loading your profile…</p>
      </Panel>
    );
  }

  const dirty = draft.displayName !== user.displayName || draft.role !== user.role;

  return (
    <Panel
      id="profile"
      icon={<User size={15} />}
      title="Your profile"
      sub="Your name, access level and password."
      foot={<ProfileActions dirty={dirty} save={save} logout={logout} />}
    >
      <div className="set-pair">
        <Field label="Full name">
          <input
            className="set-input"
            value={draft.displayName}
            aria-label="Full name"
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
          />
        </Field>

        <Field label="Email" hint="Your sign-in address. Changing it is not offered here.">
          <input className="set-input" value={user.email} readOnly aria-label="Email" />
        </Field>
      </div>

      <div className="set-sep" />

      <Row
        label="Access level"
        hint="An analyst reviews incidents and proposes actions. An admin can also approve blocks and save policy."
      >
        <CustomSelectPill
          value={draft.role}
          options={[
            { value: 'analyst', label: 'Analyst' },
            { value: 'admin', label: 'Admin' },
          ]}
          onChange={(value) => setDraft({ ...draft, role: value as ProfileDraft['role'] })}
          ariaLabel="Access level"
        />
      </Row>

      <div className="set-sep" />

      <ChangePassword />
    </Panel>
  );
}

function ChangePassword(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });

  const mut = useMutation({
    mutationFn: () =>
      postMutation('/api/auth/password', { current: form.current, next: form.next }),
    onSuccess: () => {
      setOpen(false);
      setForm({ current: '', next: '', confirm: '' });
    },
  });

  const valid = form.current.length > 0 && form.next.length >= 8 && form.next === form.confirm;

  return (
    <>
      <Row label="Password" hint="At least 8 characters. You will stay signed in on this device.">
        <button type="button" className="set-btn" onClick={() => setOpen(!open)}>
          <LockSimple size={14} /> {open ? 'Cancel' : 'Change password'}
        </button>
      </Row>

      {open && (
        <div className="set-pw">
          {(
            [
              ['current', 'Current password'],
              ['next', 'New password'],
              ['confirm', 'Confirm new password'],
            ] as const
          ).map(([key, label]) => (
            <div className="set-pw__field" key={key}>
              <label htmlFor={`pw-${key}`}>{label}</label>
              <input
                id={`pw-${key}`}
                className="set-input"
                type="password"
                value={form[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            </div>
          ))}
          {form.next.length > 0 && form.next.length < 8 && (
            <span className="set-msg set-msg--bad">Use at least 8 characters.</span>
          )}
          {form.confirm.length > 0 && form.next !== form.confirm && (
            <span className="set-msg set-msg--bad">The two new passwords do not match.</span>
          )}
          {mut.isError && <span className="set-msg set-msg--bad">{mut.error.message}</span>}
          <div className="set-pw__actions">
            <button
              type="button"
              className="set-btn set-btn--primary"
              disabled={!valid || mut.isPending}
              onClick={() => mut.mutate()}
            >
              {mut.isPending ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function NotificationsSection(): React.JSX.Element {
  const prefs = useQuery({ queryKey: [NOTIFY_PREFS_KEY], queryFn: fetchNotifyPrefs });
  const client = useQueryClient();

  const update = useMutation({
    mutationFn: (req: Partial<NotificationPrefs>) => {
      const current = prefs.data ?? { minSeverity: 'medium', simulated: true, seenAt: null };
      return postMutation('/api/notifications/prefs', {
        minSeverity: req.minSeverity ?? current.minSeverity,
        simulated: req.simulated ?? current.simulated,
      });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: [NOTIFY_PREFS_KEY] }),
  });

  const p = prefs.data ?? { minSeverity: 'medium' as NotifySeverity, simulated: true };

  return (
    <Panel
      id="notifications"
      icon={<Bell size={15} />}
      title="Notifications"
      sub="What raises the bell in the top bar."
    >
      <Row label="Notify me about" hint="The lowest severity that raises the bell.">
        <CustomSelectPill
          value={p.minSeverity}
          options={SEVERITY_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          onChange={(value) => update.mutate({ minSeverity: value as NotifySeverity })}
          // The accessible name matches the visible label rather than restating it differently.
          ariaLabel="Notify me about"
        />
      </Row>

      <div className="set-sep" />

      <Row
        label="Include simulated incidents"
        hint="Incidents raised by simulation runs, not only live traffic."
      >
        <Toggle
          checked={p.simulated}
          onChange={(checked) => update.mutate({ simulated: checked })}
          label="Include simulated incidents"
        />
      </Row>

      <Note>
        Notifications appear in the bell at the top of the console. Email and chat delivery are not
        connected in this environment.
      </Note>
    </Panel>
  );
}

function AiModelSection({
  ai,
  registry,
}: {
  ai: WorkspaceResponse['ai'] | null;
  registry: ModelRegistryResponse | undefined;
}): React.JSX.Element {
  const model = registry?.available === true ? registry.registry : null;
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

  return (
    <Panel
      id="models"
      icon={<Cpu size={15} />}
      title="AI model"
      sub="The two models Sentinel runs: the detector and the advisory assistant."
    >
      <Row
        label="Detection model"
        hint="Scores incidents. Its decision can be overridden by policy."
      >
        <span className="set-pill set-pill--muted">{model?.version ?? 'not loaded'}</span>
      </Row>

      {/* The scores the registry recorded when this version was trained — the same numbers the
          model report is built from, not a restatement of anything on screen. */}
      {model !== null && (
        <dl className="set-facts set-facts--tight">
          <div>
            <dt>PR-AUC</dt>
            <dd>{model.metricsSnapshot.prAuc.toFixed(3)}</dd>
          </div>
          <div>
            <dt>Precision</dt>
            <dd>{pct(model.metricsSnapshot.precision)}</dd>
          </div>
          <div>
            <dt>Recall</dt>
            <dd>{pct(model.metricsSnapshot.recall)}</dd>
          </div>
        </dl>
      )}

      <div className="set-sep" />

      <Row
        label="Assistant"
        hint={
          ai?.enabled === true
            ? `Answering through ${ai.provider ?? 'the configured provider'}.`
            : 'Not configured in this environment.'
        }
      >
        <span className={`set-pill set-pill--${ai?.enabled === true ? 'ok' : 'muted'}`}>
          {ai?.model ?? 'none'}
        </span>
      </Row>

      <Note>
        The assistant is advisory only — it explains and recommends, but never blocks a shopper on
        its own.
      </Note>
    </Panel>
  );
}

function DataSection({ retentionDays }: { retentionDays: number | null }): React.JSX.Element {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const reset = useMutation({
    // Wipes every stored event and incident so the demo starts clean. Dev-only server-side; in
    // production the API refuses and the error surfaces here rather than silently doing nothing.
    mutationFn: async () => {
      const response = await apiMutate('/api/replay/all', undefined, 'DELETE');
      if (!response.ok) throw new Error(`api returned ${response.status}`);
    },
    onSuccess: () => {
      setConfirming(false);
      void client.invalidateQueries();
    },
  });

  return (
    <Panel
      id="data"
      icon={<ShieldCheck size={15} />}
      title="Data & privacy"
      sub="What Sentinel keeps, and how to clear it."
    >
      <Row label="Data retention" hint="How long forensic detail is kept before it is dropped.">
        <span className="set-pill set-pill--muted">
          {retentionDays === null ? '—' : `${retentionDays} days`}
        </span>
      </Row>

      <div className="set-sep" />

      <Row
        label="What is stored"
        hint="Pseudonymised signals only — never card numbers, names, or full IP addresses."
      >
        <span className="set-pill set-pill--ok">No raw PII</span>
      </Row>

      <div className="set-sep" />

      <Row
        label="Reset demo data"
        hint="Deletes every incident and payment attempt, live and simulated. Your account and policies are untouched."
      >
        {confirming ? (
          <>
            <button
              type="button"
              className="set-btn set-btn--danger"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? 'Deleting…' : 'Yes, delete it all'}
            </button>
            <button type="button" className="set-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="set-btn set-btn--danger"
            onClick={() => setConfirming(true)}
          >
            <Trash size={14} /> Reset demo data
          </button>
        )}
      </Row>

      {reset.isError && <span className="set-msg set-msg--bad">{reset.error.message}</span>}
    </Panel>
  );
}

/** One connected service: what it is, what it has done, and whether it is working. */
function Integration({
  mark,
  name,
  detail,
  ready,
  readyWord,
}: {
  mark: string;
  name: string;
  detail: string;
  ready: boolean;
  readyWord: [on: string, off: string];
}): React.JSX.Element {
  return (
    <div className="set-int">
      <span className="set-int__mark" aria-hidden="true">
        {mark}
      </span>
      <div className="set-int__text">
        <span className="set-row__label">{name}</span>
        <span className="set-row__hint">{detail}</span>
      </div>
      <span className={`set-pill set-pill--${ready ? 'ok' : 'muted'}`}>
        {ready ? readyWord[0] : readyWord[1]}
      </span>
    </div>
  );
}

function IntegrationsSection({
  workspace,
  metrics,
}: {
  workspace: WorkspaceResponse | undefined;
  metrics: IngestionMetrics | undefined;
}): React.JSX.Element {
  const ai = workspace?.ai ?? null;
  const stored = metrics === undefined ? '—' : metrics.eventsStored.toLocaleString('en-IN');

  return (
    <Panel
      id="integrations"
      icon={<Buildings size={15} />}
      title="Integrations"
      sub="Outside services Sentinel is connected to."
    >
      <Integration
        mark="RP"
        name="Razorpay"
        detail={`Payment webhooks. ${stored} events stored · last ${ago(metrics?.lastEventReceivedAt ?? null)}`}
        ready={metrics?.configured ?? false}
        readyWord={['Configured', 'Not configured']}
      />
      <div className="set-sep" />

      <Integration
        mark="AI"
        name={ai?.provider ?? 'Language model'}
        detail={`Behind the advisory assistant. ${ai?.model ?? 'No model configured'}`}
        ready={ai?.enabled === true}
        readyWord={['Answering', 'Off']}
      />
    </Panel>
  );
}

function WorkspaceSummaryCard({
  workspace,
}: {
  workspace: WorkspaceResponse | undefined;
}): React.JSX.Element {
  const facts: { label: string; value: string }[] = [
    { label: 'Currency', value: workspace?.currency ?? '—' },
    {
      label: 'Session timeout',
      value: workspace === undefined ? '—' : `${workspace.sessionHours} hours`,
    },
    {
      label: 'Login lockout',
      value:
        workspace === undefined
          ? '—'
          : `${workspace.loginMaxAttempts} / ${workspace.loginWindowMinutes}m`,
    },
    {
      label: 'Retention',
      value: workspace === undefined ? '—' : `${workspace.retentionDays}d`,
    },
  ];

  return (
    // These come from the server's own configuration; there is nothing to edit here.
    <Panel
      id="workspace"
      icon={<LockSimple size={15} />}
      title="Workspace"
      sub="How this environment is configured. Read-only."
    >
      <dl className="set-facts set-facts--pairs">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
