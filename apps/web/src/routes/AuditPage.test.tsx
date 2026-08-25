import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditEntry, AuditVerifyResponse } from '@sentinel/contracts';
import { AuditPage } from './AuditPage.js';
import { kindLabel, payloadSummary, reasonText } from '../incidents/audit-words.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq: 1,
    at: T0,
    actor: 'Ana',
    kind: 'containment.approved',
    subjectType: 'containment',
    subjectId: 'c1',
    payload: { note: 'looks like card testing' },
    policyVersion: 1,
    policyHash: 'a1b2c3d4',
    hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    prevHash: '0'.repeat(64),
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(entries: AuditEntry[], verify?: AuditVerifyResponse): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, status: 200, json: async () => verify };
    return { ok: true, status: 200, json: async () => ({ entries }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('AuditPage', () => {
  it('lists the chained entries with their hashes', async () => {
    stub([
      entry({ seq: 2, kind: 'incident.transition', payload: { from: 'open', to: 'under_review' } }),
      entry(),
    ]);
    render(wrap(<AuditPage />));

    expect(await screen.findByText('Incident moved')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getAllByText(/abcdef0123…/).length).toBeGreaterThan(0);
  });

  it('reports an intact chain when the verifier is happy', async () => {
    stub([entry()], {
      valid: true,
      entries: 4,
      head: 'f'.repeat(64),
      firstDivergence: null,
    });
    render(wrap(<AuditPage />));
    await screen.findByText('Approved');

    await userEvent.click(screen.getByRole('button', { name: 'Verify chain' }));

    expect(await screen.findByText('The chain is intact')).toBeInTheDocument();
    expect(screen.getByText(/external anchor would pin/)).toBeInTheDocument();
  });

  it('reports exactly where and how a tampered chain broke', async () => {
    // The demo's payoff: a corrupted row is named, with the reason a person can act on.
    stub([entry()], {
      valid: false,
      entries: 6,
      head: 'f'.repeat(64),
      firstDivergence: {
        seq: 3,
        reason: 'hash-mismatch',
        detail: 'the recorded hash does not match',
      },
    });
    render(wrap(<AuditPage />));
    await screen.findByText('Approved');

    await userEvent.click(screen.getByRole('button', { name: 'Verify chain' }));

    expect(await screen.findByText(/altered at entry 3/)).toBeInTheDocument();
    expect(screen.getByText(/a field in that entry was changed/)).toBeInTheDocument();
  });

  it('points at the command-line verifier too', async () => {
    stub([entry()]);
    render(wrap(<AuditPage />));
    expect(await screen.findByText(/pnpm audit:verify/)).toBeInTheDocument();
  });

  it('surfaces a load failure rather than an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    render(wrap(<AuditPage />));
    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 500');
  });
});

describe('audit wording', () => {
  it('names each kind in plain terms', () => {
    expect(kindLabel('containment.activated')).toBe('Applied');
    expect(kindLabel('incident.transition')).toBe('Incident moved');
  });

  it('explains each divergence in terms of what happened to the record', () => {
    expect(reasonText('hash-mismatch')).toMatch(/changed after it was written/);
    expect(reasonText('sequence-gap')).toMatch(/deleted/);
    expect(reasonText('broken-link')).toMatch(/deleted or moved/);
  });

  it('summarises a transition payload as a move', () => {
    expect(payloadSummary({ from: 'open', to: 'contained', note: 'x' })).toBe(
      'open → contained — x',
    );
  });

  it('renders a code nobody has worded', () => {
    expect(kindLabel('something.new')).toBe('something new');
  });
});
