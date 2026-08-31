import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PolicyResponse, PolicyVersion, SimulationResponse } from '@sentinel/contracts';
import { PolicyPage } from './PolicyPage.js';
import { actionLabel, decisionCode, rupees } from '../incidents/policy-words.js';

function policy(overrides: Partial<PolicyResponse> = {}): PolicyResponse {
  return {
    version: 2,
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

function version(overrides: Partial<PolicyVersion> = {}): PolicyVersion {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    version: 2,
    hash: 'a1b2c3d4',
    status: 'published',
    createdBy: 'u-author',
    createdByName: 'Risk Team',
    approvedBy: 'u-admin',
    approvedByName: 'Risk Manager',
    createdAt: 1_772_000_000_000,
    approvedAt: 1_772_100_000_000,
    publishedAt: 1_772_200_000_000,
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
    policyVersion: 2,
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

// Route-aware: the page reads two endpoints and writes to three, and each needs the right shape.
function stub(
  opts: { policy?: PolicyResponse; versions?: PolicyVersion[]; sim?: SimulationResponse } = {},
): ReturnType<typeof vi.fn> {
  const body = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/api/policy/versions')) return body({ versions: opts.versions ?? [] });
    if (url.includes('/api/policy/simulate')) return body(opts.sim ?? simulation());
    if (url.includes('/api/policy/drafts'))
      return body({
        version: version({ status: 'draft', approvedBy: null, approvedByName: null }),
      });
    if (url.includes('/submit')) return body({ version: version({ status: 'pending_approval' }) });
    if (url.endsWith('/api/policy')) return body(opts.policy ?? policy());
    return body({});
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('PolicyPage', () => {
  it('shows the active policy actually loaded, with its version, hash and status', async () => {
    stub({ versions: [version()] });
    render(wrap(<PolicyPage />));

    expect(await screen.findByText('Active policy')).toBeInTheDocument();
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0);
    expect(screen.getByText('a1b2c3d4')).toBeInTheDocument();
  });

  it('surfaces a set policy kill-switch field, without claiming policy.yaml is the only source', async () => {
    stub({ policy: policy({ killSwitch: true }), versions: [version()] });
    render(wrap(<PolicyPage />));

    // The published policy's own kill-switch field is stated as read-only fact — never as a live toggle,
    // since it is the reviewed policy field, separate from the instant Kill switch card.
    expect(await screen.findByText(/kill-switch field set on/)).toBeInTheDocument();
    // The DB workflow can change the live policy, so the old "edited in policy.yaml and nowhere else" copy is gone.
    expect(screen.queryByText(/policy\.yaml and nowhere else/)).not.toBeInTheDocument();
  });

  it('previews a change against recorded incidents through the simulate endpoint', async () => {
    const fetchMock = stub({ versions: [version()] });
    render(wrap(<PolicyPage />));
    await screen.findByText('Active policy');

    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));

    expect(await screen.findByText('More payments blocked')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/policy/simulate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('calls out what a policy would newly block, on its own', async () => {
    stub({
      versions: [version()],
      sim: simulation({
        summary: { considered: 4, changed: 2, newlyContained: 2, newlyReleased: 0 },
      }),
    });
    render(wrap(<PolicyPage />));
    await screen.findByText('Active policy');

    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));

    expect(
      await screen.findByText(/would block people it does not block today/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 of 4 would newly be refused/)).toBeInTheDocument();
  });

  it('reports a broken candidate rather than fabricating a preview', async () => {
    stub({
      versions: [version()],
      sim: simulation({ rows: [], problems: ['thresholds.contain must be a number'] }),
    });
    render(wrap(<PolicyPage />));
    await screen.findByText('Active policy');

    await userEvent.click(screen.getByRole('button', { name: 'Preview impact' }));

    expect(await screen.findByText('That policy is not usable')).toBeInTheDocument();
    expect(screen.getByText(/thresholds.contain must be a number/)).toBeInTheDocument();
  });

  it('renders real policy history — version, readable status and who acted', async () => {
    stub({
      versions: [
        version(),
        version({
          id: '00000000-0000-0000-0000-000000000002',
          version: 1,
          status: 'rejected',
          hash: 'beefbeef',
          createdByName: 'Ops Team',
          approvedBy: null,
          approvedByName: null,
        }),
      ],
    });
    render(wrap(<PolicyPage />));
    await screen.findByText('Active policy');

    await userEvent.click(screen.getByRole('button', { name: /View history/i }));

    expect(await screen.findByText('Policy history')).toBeInTheDocument();
    expect(screen.getByText('Ops Team')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('keeps saving disabled until a real change is made, then creates a draft', async () => {
    const fetchMock = stub({ versions: [version()] });
    render(wrap(<PolicyPage />));
    await screen.findByText('Active policy');

    expect(screen.getByRole('button', { name: /Save as draft/ })).toBeDisabled();

    // The verification level is a fixed-step slider; 0.55 → 0.5 is one notch down the ladder (index 2).
    fireEvent.change(screen.getByLabelText('Verification risk level'), { target: { value: '2' } });
    const save = screen.getByRole('button', { name: /Save as draft/ });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/policy/drafts',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(await screen.findByText(/live policy is unchanged/)).toBeInTheDocument();
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

  it('shows money as money', () => {
    expect(rupees(48_000)).toBe('₹480');
  });
});
