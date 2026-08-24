import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Landing } from './Landing.js';

// Link needs router context, which this component test has no reason to build.
// Rendering it as a plain anchor keeps the test about the page's content.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const meta = {
  name: 'Sentinel',
  claim: 'Detects suspicious failed-payment clusters and tells them apart from outages.',
  version: '0.1.0',
  commit: 'abc1234',
  slice: { number: 1, name: 'Landing page' },
  evidenceLayers: [
    {
      id: 'L1',
      name: 'Integration',
      source: 'Real Razorpay test-mode webhooks',
      proves: 'The ingestion contract works',
      status: 'not-started',
      arrivesIn: 'Slice 4',
    },
    {
      id: 'L2',
      name: 'Scenario compliance',
      source: 'Seeded synthetic corpus',
      proves: 'The detector complies with the specifications',
      status: 'not-started',
      arrivesIn: 'Slice 9',
    },
    {
      id: 'L3',
      name: 'Benchmark',
      source: 'Public labelled fraud data',
      proves: 'Precision and recall on labels we did not author',
      status: 'not-started',
      arrivesIn: 'Slice 12',
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

function stubMeta(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => meta }));
}

describe('Landing', () => {
  it('renders the product name without waiting for the api', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sentinel' })).toBeInTheDocument();
  });

  it('always states what the project is not', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<Landing />);
    expect(screen.getByText(/not equivalent to Razorpay/i)).toBeInTheDocument();
  });

  it('renders the evidence layers from the api', async () => {
    stubMeta();
    render(<Landing />);
    expect(await screen.findByText(/L1 — Integration/)).toBeInTheDocument();
    expect(screen.getByText(/L3 — Benchmark/)).toBeInTheDocument();
  });

  it('shows the claim reported by the api rather than a hardcoded one', async () => {
    stubMeta();
    render(<Landing />);
    expect(await screen.findByText(meta.claim)).toBeInTheDocument();
  });

  it('surfaces an unreachable api instead of silently showing nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    render(<Landing />);
    expect(await screen.findByRole('alert')).toHaveTextContent('connection refused');
  });

  it('disables actions that are not real yet', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<Landing />);
    expect(screen.getByRole('button', { name: 'Replay demo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Integration verification' })).toBeDisabled();
  });
});
