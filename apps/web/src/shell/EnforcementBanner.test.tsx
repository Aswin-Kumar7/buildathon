import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { EnforcementBanner } from './EnforcementBanner.js';

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
  reason: 'false-positive storm',
};
const ENFORCING = { paused: false, since: null, by: null, reason: null };

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(me: unknown, state: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    const body = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
    if (url.includes('/api/enforcement/resume')) return body({ ...PAUSED, paused: false });
    if (url.includes('/api/enforcement')) return body(state);
    if (url.includes('/api/auth/me')) return body(me);
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('EnforcementBanner', () => {
  it('renders nothing while enforcing', async () => {
    const fetchMock = stub(admin, ENFORCING);
    render(wrap(<EnforcementBanner />));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/enforcement', expect.anything()),
    );
    expect(screen.queryByText(/Enforcement is paused/)).not.toBeInTheDocument();
  });

  it('shows a loud notice with who and why, and an admin can resume', async () => {
    const fetchMock = stub(admin, PAUSED);
    render(wrap(<EnforcementBanner />));

    expect(await screen.findByText(/Enforcement is paused/)).toBeInTheDocument();
    expect(screen.getByText(/by Demo Admin/)).toBeInTheDocument();
    expect(screen.getByText(/false-positive storm/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Resume enforcement/ }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enforcement/resume',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows analysts the notice but no control', async () => {
    stub(analyst, PAUSED);
    render(wrap(<EnforcementBanner />));

    expect(await screen.findByText(/Enforcement is paused/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume enforcement/ })).not.toBeInTheDocument();
    expect(screen.getByText(/An admin can resume it/)).toBeInTheDocument();
  });
});
