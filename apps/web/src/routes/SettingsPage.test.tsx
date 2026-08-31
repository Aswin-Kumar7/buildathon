import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IngestionMetrics, NotificationPrefs, WorkspaceResponse } from '@sentinel/contracts';
import { SettingsPage } from './SettingsPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

const ME = {
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'ana@merchant.com',
    displayName: 'Ana Ray',
    role: 'admin',
  },
  csrfToken: 'x',
};

const WORKSPACE: WorkspaceResponse = {
  environment: 'development',
  liveMode: false,
  currency: 'INR',
  retentionDays: 7,
  sessionHours: 12,
  loginMaxAttempts: 5,
  loginWindowMinutes: 15,
  ai: { enabled: true, mode: 'live', provider: 'Groq', model: 'openai/gpt-oss-120b' },
};

const METRICS: IngestionMetrics = {
  configured: true,
  eventsStored: 128,
  replayedEvents: 0,
  canonicalEvents: 128,
  duplicateDeliveries: 0,
  duplicateRate: 0,
  eventsPerMinute: 0,
  pendingDepth: 0,
  deadLetterDepth: 0,
  lateEvents: 0,
  lastEventReceivedAt: null,
  oldestPendingAgeMs: null,
  meanProcessingMs: null,
  watermark: null,
  allowedLatenessMinutes: 5,
  maxAttempts: 3,
};

const PREFS: NotificationPrefs = { minSeverity: 'low', simulated: true, seenAt: null };

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const body = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes('/api/workspace')) return body(WORKSPACE);
    if (url.includes('/api/ingestion/metrics')) return body(METRICS);
    if (url.includes('/api/notifications/prefs')) return body(PREFS);
    if (url.includes('/api/model/registry'))
      return body({
        available: true,
        registry: {
          version: 'incident-2026-01',
          trainingDataHash: 'abc123',
          featureDefinitionVersion: 'v3',
          onnxExported: true,
          metricsSnapshot: { prAuc: 0.9, precision: 0.88, recall: 0.85 },
        },
      });
    if (url.includes('/api/auth/profile'))
      return body({ user: { ...ME.user, displayName: 'Ana R.' } });
    if (url.includes('/api/auth/me')) return body(ME);
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('SettingsPage', () => {
  it('shows the reorganised sections from real backend data', async () => {
    stub();
    render(wrap(<SettingsPage />));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    // AI model — both the detector version and the assistant, from the registry and workspace.
    expect(await screen.findByText('AI model')).toBeInTheDocument();
    expect(screen.getByText('incident-2026-01')).toBeInTheDocument();
    // The assistant model appears in both the AI-model section and the Groq integration row.
    expect(screen.getAllByText('openai/gpt-oss-120b').length).toBeGreaterThan(0);
    expect(screen.getByText('Answering live')).toBeInTheDocument();
    // Notifications, Data & privacy, Integrations are present.
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getByText('Integrations')).toBeInTheDocument();
    expect(screen.getByText('Razorpay')).toBeInTheDocument();
    // The removed sections are gone.
    expect(screen.queryByText(/Diagnostics/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Team & access/)).not.toBeInTheDocument();
    expect(screen.queryByText('Protection')).not.toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('has an editable profile that saves name and role to the backend', async () => {
    const fetchMock = stub();
    render(wrap(<SettingsPage />));

    const name = await screen.findByLabelText('Full name');
    expect(name).toHaveValue('Ana Ray');
    expect(screen.getByLabelText('Email')).toBeDisabled();
    expect(screen.getByLabelText('Access level')).toHaveValue('admin');

    await userEvent.clear(name);
    await userEvent.type(name, 'Ana R.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/profile',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('saves a notification preference change to the backend', async () => {
    const fetchMock = stub();
    render(wrap(<SettingsPage />));

    const select = await screen.findByLabelText('Notify me about');
    await userEvent.selectOptions(select, 'high');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/prefs',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
