import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, PageHeader } from '@sentinel/ui';
import { modelRegistryResponseSchema, type ModelRegistryResponse } from '@sentinel/contracts';
import { useSession, useLogout } from '../auth/useSession.js';
import './SettingsPage.css';

async function fetchRegistry(): Promise<ModelRegistryResponse> {
  const response = await fetch('/api/model/registry', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return modelRegistryResponseSchema.parse(await response.json());
}

const DIAGNOSTICS = [
  {
    to: '/console/attempts',
    label: 'Payment attempts',
    desc: 'The redacted event stream the detector reads.',
  },
  {
    to: '/console/features',
    label: 'Feature inspector',
    desc: 'Per-entity feature vectors, as computed live.',
  },
  {
    to: '/console/compare',
    label: 'Three that look alike',
    desc: 'Attack vs outage vs dunning, judged side by side.',
  },
  {
    to: '/console/health',
    label: 'System health',
    desc: 'Load, latency and graceful shedding in real time.',
  },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="settings__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { user } = useSession();
  const logout = useLogout();
  const registry = useQuery({ queryKey: ['model-registry'], queryFn: fetchRegistry });

  const modelVersion = registry.data?.available === true ? registry.data.registry.version : '—';

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Your account, this workspace's environment, and the raw diagnostic views."
      />

      <div className="settings__grid">
        <Card title="Account">
          <dl className="settings__list">
            <Row label="Name">{user?.displayName ?? '—'}</Row>
            <Row label="Email">{user?.email ?? '—'}</Row>
            <Row label="Role">
              <Badge tone="accent">{user?.role ?? 'analyst'}</Badge>
            </Row>
          </dl>
          <div className="settings__foot">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </Card>

        <Card title="Environment">
          <dl className="settings__list">
            <Row label="Mode">
              <Badge tone="warn" dot>
                Test mode
              </Badge>
            </Row>
            <Row label="Payments">Razorpay test keys — no live money moves.</Row>
            <Row label="Currency">INR (paise)</Row>
            <Row label="Deployed model">
              <code>{modelVersion}</code>
            </Row>
          </dl>
          <div className="settings__foot">
            <Link to="/console/metrics" className="settings__link">
              View model evaluation →
            </Link>
          </div>
        </Card>
      </div>

      <Card
        title="Diagnostics"
        subtitle="The raw operational views, kept out of the main navigation."
      >
        <ul className="settings__diag">
          {DIAGNOSTICS.map((item) => (
            <li key={item.to}>
              <Link to={item.to}>
                <span className="settings__diag-label">{item.label}</span>
                <span className="settings__diag-desc">{item.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
