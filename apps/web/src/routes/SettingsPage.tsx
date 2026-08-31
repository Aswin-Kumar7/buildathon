import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ingestionMetricsSchema,
  modelRegistryResponseSchema,
  notificationPrefsSchema,
  workspaceResponseSchema,
  type IngestionMetrics,
  type ModelRegistryResponse,
  type NotificationPrefs,
  type NotifySeverity,
  type UpdateNotificationPrefsRequest,
  type WorkspaceResponse,
} from '@sentinel/contracts';
import { SESSION_KEY, useLogout, useSession } from '../auth/useSession.js';
import { apiMutate, csrfHeaders } from '../auth/api.js';
import { NOTIFY_PREFS_KEY } from '../shell/NotificationBell.js';
import { Toggle } from './policy-ui.js';
import './SettingsPage.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import { User, Cpu, Bell, Shield, ArrowSquareOut, CaretDown } from '@phosphor-icons/react';

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
const pillClass = (cls: string): string => (cls === '' ? 'set-pill' : `set-pill set-pill--${cls}`);

export function SettingsPage(): React.JSX.Element {
  const workspace = useQuery({ queryKey: ['workspace'], queryFn: fetchWorkspace });
  const registry = useQuery({ queryKey: ['model-registry'], queryFn: fetchRegistry });
  const metrics = useQuery({ queryKey: ['ingestion-metrics'], queryFn: fetchMetrics });

  return (
    <div className="set-page">
      <header className="set-header">
        <div className="set-header__left">
          <h1>Settings</h1>
          <p>
            Manage your profile, AI detection models, notification triggers, and live integrations.
          </p>
        </div>
        <div className="set-header__badges">
          <span className="set-env-badge">
            <span className="set-env-dot" />
            {workspace.data?.environment ?? 'development'}
          </span>
          <span className="set-mode-badge">
            {workspace.data?.liveMode ? 'Live Mode' : 'Test Mode'}
          </span>
        </div>
      </header>

      <div className="set-grid">
        <div className="set-grid__main">
          <AccountSection />
          <NotificationsSection />
          <DataSection retentionDays={workspace.data?.retentionDays ?? null} />
        </div>

        <aside className="set-grid__sidebar">
          <AiModelSection ai={workspace.data?.ai ?? null} registry={registry.data} />
          <IntegrationsSection
            workspace={workspace.data}
            metrics={metrics.data}
            metricsError={metrics.isError ? metrics.error.message : null}
          />
          <WorkspaceSummaryCard workspace={workspace.data} />
        </aside>
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="set-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AccountSection(): React.JSX.Element {
  const { user } = useSession();
  const client = useQueryClient();
  const logout = useLogout();
  const [draft, setDraft] = useState<{ displayName: string; role: 'analyst' | 'admin' } | null>(
    null,
  );

  useEffect(() => {
    if (user !== null && draft === null)
      setDraft({ displayName: user.displayName, role: user.role });
  }, [user, draft]);

  const save = useMutation({
    mutationFn: () => postMutation('/api/auth/profile', draft),
    onSuccess: () => void client.invalidateQueries({ queryKey: SESSION_KEY }),
  });

  if (user === null || draft === null)
    return (
      <section className="set-card">
        <p className="set-note">Loading your profile…</p>
      </section>
    );

  const dirty = draft.displayName.trim() !== user.displayName || draft.role !== user.role;
  const valid = draft.displayName.trim() !== '';

  return (
    <section className="set-card">
      <header className="set-card__head">
        <div className="set-card__title-group">
          <span className="set-card__badge set-card__badge--blue">
            <User />
          </span>
          <div>
            <h2>Your profile</h2>
            <p>Your name, access level and password.</p>
          </div>
        </div>
      </header>

      <div className="set-profile">
        <label>
          <span>Full name</span>
          <input
            type="text"
            value={draft.displayName}
            onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
            maxLength={80}
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={user.email}
            disabled
            title="Your email is your sign-in and can't be changed here."
          />
        </label>
        <label>
          <span>Access level</span>
          <CustomSelectPill
            value={draft.role}
            options={[
              { value: 'analyst', label: 'Analyst' },
              { value: 'admin', label: 'Admin' },
            ]}
            onChange={(val) => setDraft({ ...draft, role: val as 'analyst' | 'admin' })}
            ariaLabel="Access level"
            variant="field"
          />
        </label>
      </div>

      <p className="set-note">
        An <strong>analyst</strong> reviews incidents and proposes actions. An{' '}
        <strong>admin</strong> can also approve blocks and publish policy. Changing this changes
        what you can do.
      </p>
      {save.isError && (
        <p className="set-note set-note--bad" role="alert">
          Couldn't save your profile. {save.error.message}
        </p>
      )}

      <div className="set-card__foot">
        <button
          type="button"
          className="set-btn set-btn--primary"
          onClick={() => save.mutate()}
          disabled={!dirty || !valid || save.isPending}
        >
          {save.isPending ? 'Saving…' : save.isSuccess && !dirty ? 'Saved' : 'Save changes'}
        </button>
        <ChangePassword />
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </section>
  );
}

function ChangePassword(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const change = useMutation({
    mutationFn: () =>
      postMutation('/api/auth/password', {
        currentPassword: form.current,
        newPassword: form.next,
      }),
    onSuccess: () => {
      setForm({ current: '', next: '', confirm: '' });
      setOpen(false);
    },
  });
  const valid = form.current !== '' && form.next.length >= 8 && form.next === form.confirm;

  if (!open) {
    return (
      <span className="set-pw">
        <button type="button" className="set-linkbtn" onClick={() => setOpen(true)}>
          Change password
        </button>
        {change.isSuccess && <span className="set-pw__done">Password changed.</span>}
      </span>
    );
  }
  return (
    <form
      className="set-pwform"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) change.mutate();
      }}
    >
      <label>
        <span>Current password</span>
        <input
          type="password"
          value={form.current}
          onChange={(event) => setForm({ ...form, current: event.target.value })}
          autoComplete="current-password"
        />
      </label>
      <label>
        <span>New password</span>
        <input
          type="password"
          value={form.next}
          onChange={(event) => setForm({ ...form, next: event.target.value })}
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />
      </label>
      <label>
        <span>Confirm new password</span>
        <input
          type="password"
          value={form.confirm}
          onChange={(event) => setForm({ ...form, confirm: event.target.value })}
          autoComplete="new-password"
        />
      </label>
      {form.confirm !== '' && form.next !== form.confirm && (
        <p className="set-note set-note--bad">The new passwords don't match.</p>
      )}
      {change.isError && (
        <p className="set-note set-note--bad" role="alert">
          {change.error.message}
        </p>
      )}
      <div className="set-formfoot">
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={() => setOpen(false)}
          disabled={change.isPending}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="set-btn set-btn--primary"
          disabled={!valid || change.isPending}
        >
          {change.isPending ? 'Saving…' : 'Update password'}
        </button>
      </div>
    </form>
  );
}

function NotificationsSection(): React.JSX.Element {
  const client = useQueryClient();
  const prefs = useQuery({ queryKey: NOTIFY_PREFS_KEY, queryFn: fetchNotifyPrefs });
  const save = useMutation({
    mutationFn: (patch: UpdateNotificationPrefsRequest) =>
      postMutation('/api/notifications/prefs', patch),
    onSuccess: () => void client.invalidateQueries({ queryKey: NOTIFY_PREFS_KEY }),
  });

  return (
    <section className="set-card">
      <header className="set-card__head">
        <div className="set-card__title-group">
          <span className="set-card__badge set-card__badge--purple">
            <Bell />
          </span>
          <div>
            <h2>Notifications</h2>
            <p>
              What raises the notification bell in the top bar. Each notification is a real incident
              the moment it&rsquo;s detected — there&rsquo;s no email or chat delivery in this
              environment.
            </p>
          </div>
        </div>
      </header>
      {prefs.isError ? (
        <p className="set-note set-note--bad" role="alert">
          Couldn&rsquo;t load your notification settings. {prefs.error.message}
        </p>
      ) : prefs.data === undefined ? (
        <p className="set-note" role="status">
          Loading…
        </p>
      ) : (
        <>
          <div className="set-field-group">
            <label className="set-field">
              <span>Notify me about</span>
              <CustomSelectPill
                value={prefs.data.minSeverity}
                options={SEVERITY_OPTIONS}
                onChange={(val) => save.mutate({ minSeverity: val as NotifySeverity })}
                ariaLabel="Notify me about"
                variant="field"
              />
            </label>
          </div>
          <div className="set-switchrow">
            <div>
              <strong>Include simulated incidents</strong>
              <span>Get notified about incidents from simulation runs, not only live traffic.</span>
            </div>
            <Toggle
              checked={prefs.data.simulated}
              onChange={(next) => save.mutate({ simulated: next })}
              disabled={save.isPending}
              label="Include simulated incidents"
            />
          </div>
          {save.isError && (
            <p className="set-note set-note--bad" role="alert">
              Couldn&rsquo;t save. {save.error.message}
            </p>
          )}
          <p className="set-note">
            Notifications appear in the <strong>bell</strong> at the top of the console. Email and
            chat delivery aren&rsquo;t connected in this environment.
          </p>
        </>
      )}
    </section>
  );
}

function DataSection({ retentionDays }: { retentionDays: number | null }): React.JSX.Element {
  const client = useQueryClient();
  const reset = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/replay/all', {
        method: 'DELETE',
        credentials: 'include',
        headers: csrfHeaders(),
      });
      if (!response.ok) throw new Error(`api returned ${response.status}`);
      return response.json() as Promise<{ removed: number }>;
    },
    onSuccess: () => void client.invalidateQueries(),
  });
  const confirmReset = (): void => {
    if (
      window.confirm(
        'Delete all incidents and payment-attempt data (live and simulated)? This cannot be undone.',
      )
    )
      reset.mutate();
  };
  return (
    <section className="set-card">
      <header className="set-card__head">
        <div className="set-card__title-group">
          <span className="set-card__badge set-card__badge--green">
            <Shield />
          </span>
          <div>
            <h2>Data &amp; privacy</h2>
            <p>What Sentinel keeps, and how to clear it.</p>
          </div>
        </div>
      </header>
      <dl className="set-facts">
        <Fact label="Data retention">{retentionDays === null ? '—' : `${retentionDays} days`}</Fact>
        <Fact label="What's stored">
          Pseudonymised signals only — never card numbers, names, or full IP addresses.
        </Fact>
      </dl>
      <div className="set-danger">
        <div>
          <strong>Reset demo data</strong>
          <span>
            Deletes every incident and payment attempt, live and simulated. Your account and
            policies are untouched.
          </span>
        </div>
        <button
          type="button"
          className="set-btn set-btn--danger"
          onClick={confirmReset}
          disabled={reset.isPending}
        >
          {reset.isPending
            ? 'Resetting…'
            : reset.isSuccess
              ? `Cleared ${reset.data?.removed ?? 0}`
              : 'Reset demo data'}
        </button>
      </div>
    </section>
  );
}

function AiModelSection({
  ai,
  registry,
}: {
  ai: WorkspaceResponse['ai'] | null;
  registry: ModelRegistryResponse | undefined;
}): React.JSX.Element {
  const model = registry?.available === true ? registry.registry.version : '—';
  return (
    <section className="set-card">
      <header className="set-card__head">
        <div className="set-card__title-group">
          <span className="set-card__badge set-card__badge--blue">
            <Cpu />
          </span>
          <div>
            <h2>AI model</h2>
            <p>The two models Sentinel runs: detector and advisory assistant.</p>
          </div>
        </div>
      </header>
      <dl className="set-facts set-facts--column">
        <Fact label="Detection model">
          <code className="set-code">{model}</code>
        </Fact>
        <Fact label="Assistant">
          {ai === null ? (
            '—'
          ) : (
            <span className={ai.enabled ? 'set-pill set-pill--ok' : 'set-pill'}>
              {ai.enabled ? 'Answering live' : 'Local explanations'}
            </span>
          )}
        </Fact>
        {ai !== null && ai.provider !== null && <Fact label="Provider">{ai.provider}</Fact>}
        {ai !== null && ai.model !== null && (
          <Fact label="Assistant model">
            <code className="set-code">{ai.model}</code>
          </Fact>
        )}
      </dl>
      <p className="set-note">
        The assistant is advisory only — it explains and recommends, but never blocks a shopper on
        its own.
      </p>
    </section>
  );
}

function IntegrationsSection({
  workspace,
  metrics,
  metricsError,
}: {
  workspace: WorkspaceResponse | undefined;
  metrics: IngestionMetrics | undefined;
  metricsError: string | null;
}): React.JSX.Element {
  return (
    <section className="set-card">
      <header className="set-card__head">
        <div className="set-card__title-group">
          <span className="set-card__badge set-card__badge--purple">
            <ArrowSquareOut />
          </span>
          <div>
            <h2>Integrations</h2>
            <p>Outside services Sentinel is connected to.</p>
          </div>
        </div>
      </header>
      <div className="set-integrations">
        <RazorpayIntegration workspace={workspace} metrics={metrics} error={metricsError} />
        <GroqIntegration ai={workspace?.ai ?? null} />
      </div>
    </section>
  );
}

function RazorpayIntegration({
  workspace,
  metrics,
  error,
}: {
  workspace: WorkspaceResponse | undefined;
  metrics: IngestionMetrics | undefined;
  error: string | null;
}): React.JSX.Element {
  const status =
    error !== null
      ? { cls: 'bad', text: 'Unavailable' }
      : metrics === undefined
        ? { cls: '', text: '—' }
        : metrics.configured
          ? { cls: 'ok', text: 'Connected' }
          : { cls: 'warn', text: 'Not configured' };
  return (
    <div className="set-integration">
      <span className="set-integration__mark" aria-hidden="true">
        R
      </span>
      <div className="set-integration__body">
        <div className="set-integration__top">
          <strong>Razorpay</strong>
          <span className={pillClass(status.cls)}>{status.text}</span>
        </div>
        <p>Payment webhooks feed.</p>
        <dl className="set-facts set-facts--tight">
          <Fact label="Mode">
            {workspace === undefined ? '—' : workspace.liveMode ? 'Live keys' : 'Test keys'}
          </Fact>
          <Fact label="Events received">
            {metrics === undefined ? '—' : metrics.eventsStored.toLocaleString('en-IN')}
          </Fact>
          <Fact label="Last delivery">
            {metrics === undefined ? '—' : ago(metrics.lastEventReceivedAt)}
          </Fact>
        </dl>
      </div>
    </div>
  );
}

function GroqIntegration({ ai }: { ai: WorkspaceResponse['ai'] | null }): React.JSX.Element {
  const configured = ai !== null && ai.provider !== null;
  const status =
    ai === null
      ? { cls: '', text: '—' }
      : ai.enabled
        ? { cls: 'ok', text: 'Connected' }
        : configured
          ? { cls: 'warn', text: 'Standby' }
          : { cls: '', text: 'Not configured' };
  return (
    <div className="set-integration">
      <span className="set-integration__mark set-integration__mark--groq" aria-hidden="true">
        AI
      </span>
      <div className="set-integration__body">
        <div className="set-integration__top">
          <strong>{ai?.provider ?? 'AI provider'}</strong>
          <span className={pillClass(status.cls)}>{status.text}</span>
        </div>
        <p>Language model behind advisory assistant.</p>
        <dl className="set-facts set-facts--tight">
          <Fact label="Model">
            {ai?.model === null || ai?.model === undefined ? (
              '—'
            ) : (
              <code className="set-code">{ai.model}</code>
            )}
          </Fact>
          <Fact label="Mode">{ai === null ? '—' : ai.mode}</Fact>
        </dl>
      </div>
    </div>
  );
}

function WorkspaceSummaryCard({
  workspace,
}: {
  workspace: WorkspaceResponse | undefined;
}): React.JSX.Element {
  return (
    <section className="set-card set-card--summary">
      <header className="set-card__head">
        <div className="set-card__title-group">
          <span className="set-card__badge set-card__badge--green">
            <Shield />
          </span>
          <div>
            <h2>Workspace overview</h2>
            <p>System configuration &amp; rules.</p>
          </div>
        </div>
      </header>
      <dl className="set-facts set-facts--column">
        <Fact label="Currency">{workspace?.currency ?? 'INR'}</Fact>
        <Fact label="Session timeout">
          {workspace === undefined ? '—' : `${workspace.sessionHours} hours`}
        </Fact>
        <Fact label="Login attempt limit">
          {workspace === undefined
            ? '—'
            : `${workspace.loginMaxAttempts} in ${workspace.loginWindowMinutes}m`}
        </Fact>
      </dl>
    </section>
  );
}
