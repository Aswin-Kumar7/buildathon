import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Landing } from './Landing.js';

// Link needs router context, which this component test has no reason to build.
// Rendering it as a plain anchor keeps the test about the page's content.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

const layer = (id: string, name: string) => ({
  id,
  name,
  source: 'source',
  proves: 'proves',
  status: 'not-started' as const,
  arrivesIn: 'Slice 1',
});
const meta = {
  name: 'Sentinel',
  claim: 'Detects suspicious failed-payment clusters and tells them apart from outages.',
  version: '0.16.1',
  commit: 'abc1234',
  slice: { number: 16, name: 'Redesign' },
  evidenceLayers: [layer('L1', 'Integration'), layer('L2', 'Compliance'), layer('L3', 'Benchmark')],
  model: { prAuc: 0.94, recall: 0.971, falseDeclineRate: 0.1 },
};

afterEach(() => vi.unstubAllGlobals());

function stubDown(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
}
function stubMeta(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => meta }));
}

describe('Landing', () => {
  it('renders the hero immediately, without waiting for the api', () => {
    stubDown();
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/catch card testing/i);
  });

  it('leads the reader to the console', () => {
    stubDown();
    render(<Landing />);
    // Two entry points (hero + final CTA), both routing to the login/console.
    expect(screen.getAllByRole('button', { name: /open the console/i }).length).toBeGreaterThan(0);
  });

  it('offers the storefront as the other half of the demo', () => {
    stubDown();
    render(<Landing />);
    expect(screen.getByRole('button', { name: /view the storefront/i })).toBeInTheDocument();
  });

  it('states the product’s differentiator plainly', () => {
    stubDown();
    render(<Landing />);
    expect(screen.getByText(/the model you’re shown is the model that runs/i)).toBeInTheDocument();
    expect(screen.getByText(/A model you can trust/i)).toBeInTheDocument();
  });

  it('shows the build version once the api answers', async () => {
    stubMeta();
    render(<Landing />);
    expect(await screen.findByText(/0\.16\.1/)).toBeInTheDocument();
  });
});
