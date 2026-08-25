import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PolicyResponse, SimulationResponse } from '@sentinel/contracts';
import { PolicyPage } from './PolicyPage.js';
import { actionLabel, decisionCode, rupees } from '../incidents/policy-words.js';

function policy(overrides: Partial<PolicyResponse> = {}): PolicyResponse {
  return {
    version: 1,
    hash: 'a1b2c3d4',
    killSwitch: false,
    thresholds: { stepUp: 0.55, contain: 0.75 },
    containment: { defaultMinutes: 30, maxMinutes: 120, maxExtensions: 2 },
    approval: { dualApprovalAbovePaise: 50_000, containmentAlwaysNeedsApproval: true },
    impactCaps: {
      maxActiveContainments: 5,
      maxContainmentsPerHour: 10,
      maxShareOfActiveSessions: 0.05,
      shareAppliesAboveSessions: 20,
    },
    degradation: {
      maxFeatureAgeMinutes: 15,
      requireConfirmedCounts: true,
      refuseWhenArbitrationAbstained: true,
    },
    costs: { chargebackPaise: 150_000, blockedShopperPaise: 120_000, reviewPaise: 20_000 },
    allowlisted: { sessions: 0, devices: 0, networks: 0 },
    ...overrides,
  };
}

function simulation(overrides: Partial<SimulationResponse> = {}): SimulationResponse {
  const decision = {
    action: 'contain' as const,
    reasons: [],
    refusals: [],
    approvalsRequired: 1,
    expiresAfterMinutes: 30,
    expectedCost: { ifWeAct: 48_000, ifWeWait: 900_000, currency: 'INR' as const },
    policyVersion: 1,
    policyHash: 'a1b2c3d4',
  };

  return {
    rows: [
      {
        incidentId: 'i1',
        entityKind: 'session',
        entityKey: 'v1:abcdef0123',
        detectedAt: 1_772_355_921_000,
        current: decision,
        proposed: { ...decision, action: 'escalate' },
        changed: true,
      },
    ],
    summary: { considered: 1, changed: 1, newlyContained: 0, newlyReleased: 1 },
    problems: [],
    ...overrides,
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(current: PolicyResponse, result?: SimulationResponse): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (init?.method === 'POST' ? (result ?? simulation()) : current),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('PolicyPage', () => {
  it('shows the policy actually loaded, with its version and hash', async () => {
    stub(policy());
    render(wrap(<PolicyPage />));

    expect(await screen.findByText(/Version 1/)).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('says the kill switch is engaged when it is', async () => {
    stub(policy({ killSwitch: true }));
    render(wrap(<PolicyPage />));

    expect(await screen.findByText('kill switch engaged')).toBeInTheDocument();
  });

  it('says the policy is edited in a file and nowhere else', async () => {
    // A policy that can be changed from a console is one whose history lives in a table nobody
    // diffs. Worth stating on the page a person would otherwise expect to edit.
    stub(policy());
    render(wrap(<PolicyPage />));

    expect(await screen.findByText(/policy.yaml/)).toBeInTheDocument();
  });

  it('simulates a candidate against incidents that already happened', async () => {
    const fetchMock = stub(policy());
    render(wrap(<PolicyPage />));
    await screen.findByText(/Version 1/);

    await userEvent.type(screen.getByRole('textbox'), 'version: 1');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(await screen.findByText('Incidents considered')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/policy/simulate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls out what a policy would newly block, on its own', async () => {
    // More containment is the direction that costs somebody their checkout, so it is not folded
    // into a "changed" count where it could pass unnoticed.
    stub(
      policy(),
      simulation({ summary: { considered: 4, changed: 2, newlyContained: 2, newlyReleased: 0 } }),
    );
    render(wrap(<PolicyPage />));
    await screen.findByText(/Version 1/);

    await userEvent.type(screen.getByRole('textbox'), 'version: 1');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(
      await screen.findByText(/would block people it does not block today/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 4 would newly be refused/)).toBeInTheDocument();
  });

  it('reports a broken candidate rather than failing at the person editing it', async () => {
    stub(policy(), simulation({ rows: [], problems: ['thresholds.contain must be a number'] }));
    render(wrap(<PolicyPage />));
    await screen.findByText(/Version 1/);

    await userEvent.type(screen.getByRole('textbox'), 'nonsense');
    await userEvent.click(screen.getByRole('button', { name: 'Simulate' }));

    expect(await screen.findByText(/That policy is not usable/)).toBeInTheDocument();
    expect(screen.getByText(/thresholds.contain must be a number/)).toBeInTheDocument();
  });

  it('will not simulate nothing', async () => {
    stub(policy());
    render(wrap(<PolicyPage />));
    await screen.findByText(/Version 1/);

    expect(screen.getByRole('button', { name: 'Simulate' })).toBeDisabled();
  });
});

describe('policy wording', () => {
  it('names each action in the terms somebody affected would use', () => {
    expect(actionLabel('contain')).toBe('Refuse further attempts');
    expect(actionLabel('step_up')).toBe('Ask for another factor');
  });

  it('explains a refusal rather than printing its code', () => {
    expect(decisionCode('feature_state_is_stale')).toMatch(/cannot see clearly/);
    expect(decisionCode('would_contain_too_much_of_the_shop')).toMatch(/too much of the shop/);
  });

  it('renders a parameterised code with its number', () => {
    expect(decisionCode('attack_supported_at_0.93')).toContain('93%');
  });

  it('still renders a code nobody has worded', () => {
    // A missing phrase must never make a refusal disappear.
    expect(decisionCode('some_new_refusal')).toBe('some new refusal');
  });

  it('shows money as money', () => {
    expect(rupees(48_000)).toBe('₹480');
  });
});
