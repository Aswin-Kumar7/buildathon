import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditEntry, AuditVerifyResponse } from '@sentinel/contracts';
import { AuditPage } from './AuditPage.js';
import { kindLabel, payloadSummary, reasonText } from '../incidents/audit-words.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

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
  it('lists chained entries with a truncated hash and no Detail column', async () => {
    stub([
      entry({
        seq: 2,
        kind: 'incident.transition',
        actor: 'Bo',
        hash: '1'.repeat(64),
        payload: { from: 'open', to: 'under_review', note: 'x' },
      }),
      entry(),
    ]);
    render(wrap(<AuditPage />));

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Incident moved')).toBeInTheDocument();
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    expect(within(table).getByText('Ana')).toBeInTheDocument();
    // Hashes are technical detail, hidden until asked for.
    expect(within(table).queryByText(/abcdef012345…/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(within(table).getByText(/abcdef012345…/)).toBeInTheDocument();
    // The Detail column was removed; the payload note lives only in the drawer now.
    expect(within(table).queryByText('looks like card testing')).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Detail' })).not.toBeInTheDocument();
  });

  it('opens the details drawer for the clicked event, from data already loaded', async () => {
    stub([
      entry({
        seq: 7,
        kind: 'incident.transition',
        subjectType: 'incident',
        subjectId: 'inc-9',
        payload: { from: 'open', to: 'resolved', note: 'Re-evaluated as retry storm' },
      }),
    ]);
    render(wrap(<AuditPage />));
    const table = await screen.findByRole('table');

    await userEvent.click(within(table).getByText('Incident moved'));

    const drawer = await screen.findByRole('dialog', { name: 'Audit event details' });
    expect(within(drawer).getByText('Event #7')).toBeInTheDocument();
    expect(within(drawer).getByText('Performed by')).toBeInTheDocument();
    // Real before/after from the payload, and the backend reason verbatim.
    expect(within(drawer).getByText('Resolved')).toBeInTheDocument();
    expect(within(drawer).getByText('Re-evaluated as retry storm')).toBeInTheDocument();
    // The full hash, not the truncation.
    expect(
      within(drawer).getByText('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
    ).toBeInTheDocument();
  });

  it('confirms an intact chain only when the backend verifier does', async () => {
    stub([entry()], { valid: true, entries: 4, head: 'f'.repeat(64), firstDivergence: null });
    render(wrap(<AuditPage />));

    // Verified automatically on load and shown as a badge — no button to press.
    expect(await screen.findByText('Tamper-checked')).toBeInTheDocument();
  });

  it('reports exactly where and how a tampered chain broke', async () => {
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
    expect(await screen.findByText(/Unable to load audit events/)).toBeInTheDocument();
  });
});

describe('audit wording', () => {
  it('names each kind in plain terms, including policy governance', () => {
    expect(kindLabel('containment.activated')).toBe('Applied');
    expect(kindLabel('incident.transition')).toBe('Incident moved');
    expect(kindLabel('policy.submitted')).toBe('Policy submitted');
  });

  it('explains each divergence in terms of what happened to the record', () => {
    expect(reasonText('hash-mismatch')).toMatch(/changed after it was written/);
    expect(reasonText('sequence-gap')).toMatch(/deleted/);
  });

  it('summarises a transition payload as a move', () => {
    expect(payloadSummary({ from: 'open', to: 'contained', note: 'x' })).toBe(
      'open → contained — x',
    );
  });
});
