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
  storefrontUrl: null,
  claim: 'Detects suspicious failed-payment clusters and tells them apart from outages.',
  version: '0.21.0',
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
  it('leads with what the product detects, without waiting for the api', () => {
    stubDown();
    render(<Landing />);
    // The headline has to name the thing Sentinel finds, not just set a scene, and it has to be
    // there on first paint rather than after the meta request resolves.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/finds the attack/i);
  });

  it('routes every call to action at the console', () => {
    stubDown();
    render(<Landing />);
    const toConsole = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/login');
    expect(toConsole.length).toBeGreaterThanOrEqual(3);
  });

  it('states the differentiators plainly, as claims a merchant can check', () => {
    stubDown();
    render(<Landing />);
    expect(screen.getByText(/they lift after 30 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/pr-auc on unseen attacks/i)).toBeInTheDocument();
  });

  it('answers the ten questions a merchant actually asks', () => {
    stubDown();
    render(<Landing />);
    // Only the FAQ rows carry a question mark, so this counts them without matching the
    // "/01".."/04" labels used elsewhere on the page.
    const questions = screen.getAllByRole('button').filter((b) => b.textContent?.includes('?'));
    expect(questions).toHaveLength(10);
    expect(screen.getByText(/will it block my real customers\?/i)).toBeInTheDocument();
  });

  it('shows the build version once the api answers', async () => {
    stubMeta();
    render(<Landing />);
    expect(await screen.findByText(/0\.21\.0/)).toBeInTheDocument();
  });
});
