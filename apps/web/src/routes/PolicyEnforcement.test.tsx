import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { EnforcementCard } from './PolicyEnforcement.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

const UUID = '00000000-0000-0000-0000-000000000001';
const admin = {
  user: { id: UUID, email: 'a@x.com', displayName: 'Demo Admin', role: 'admin' },
  csrfToken: 'x',
};
const analyst = {
  user: { id: UUID, email: 'b@x.com', displayName: 'An Analyst', role: 'analyst' },
  csrfToken: 'x',
};
const PAUSED = {
  paused: true,
  since: '2026-08-31T09:00:00.000Z',
  by: 'Demo Admin',
  reason: 'storm',
};
const ENFORCING = { paused: false, since: null, by: null, reason: null };

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(me: unknown, state: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const body = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes('/api/enforcement/pause'))
      return body({ state: { ...ENFORCING, paused: true }, released: 2 });
    if (url.includes('/api/enforcement/resume')) return body(ENFORCING);
    if (url.includes('/api/enforcement')) return body(state);
    if (url.includes('/api/auth/me')) return body(me);
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('EnforcementCard', () => {
  it('confirms before engaging, then calls the backend', async () => {
    const fetchMock = stub(admin, ENFORCING);
    render(wrap(<EnforcementCard />));

    // The card no longer carries a state pill of its own — the page header holds the one live
    // indicator — so readiness is the control being present.
    await userEvent.click(await screen.findByRole('button', { name: 'Engage kill switch' }));

    // A confirm step spells out the consequence before anything happens.
    expect(screen.getByText(/releases every active block/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/enforcement/pause', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Stop & release all blocks' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enforcement/pause',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the stopped state with who/why and offers to turn protection back on', async () => {
    stub(admin, PAUSED);
    render(wrap(<EnforcementCard />));

    // Stopped state is stated in full by the meta line rather than a pill.
    expect(await screen.findByText(/Nobody is being blocked/)).toBeInTheDocument();
    expect(screen.getByText(/by Demo Admin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn protection back on' })).toBeInTheDocument();
  });

  it('gives a non-admin no controls', async () => {
    stub(analyst, ENFORCING);
    render(wrap(<EnforcementCard />));

    expect(await screen.findByText(/Only an admin can use the kill switch/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Engage kill switch' })).not.toBeInTheDocument();
  });
});
