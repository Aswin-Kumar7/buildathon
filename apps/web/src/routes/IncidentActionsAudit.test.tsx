import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  AuditEntry,
  ContainmentDto,
  IncidentDetail,
  RiskRecommendation,
} from '@sentinel/contracts';
import { ActionsAuditTab } from './IncidentActionsAudit.js';

const T = Date.parse('2026-03-01T09:00:00.000Z');

function recommendation(over: Partial<RiskRecommendation> = {}): RiskRecommendation {
  return {
    incidentId: 'a1',
    action: 'contain',
    actionLabel: 'Block suspicious activity',
    rationale: 'The evidence points to card testing — recommend blocking further attempts.',
    rationaleAuthored: false,
    keyReasons: [
      {
        id: 'distinct_cards',
        text: '36 different cards from one network',
        evidence: ['distinctCards'],
      },
    ],
    whatWouldChange: [
      {
        id: 'attempts_stop',
        text: 'If the attempts stop, the incident expires.',
        evidence: ['mechanism'],
      },
    ],
    alignment: 'aligned',
    alignmentNote: 'Consistent with the policy engine and the model’s read.',
    refusals: [],
    policyAction: 'contain',
    modelAvailable: true,
    degraded: false,
    rehearsal: false,
    source: 'local',
    reasoningVersion: 'rm-r1',
    groundingHash: 'abc123def456',
    rationaleClaimIds: ['distinct_cards'],
    whatWouldChangeIds: ['attempts_stop'],
    dropped: 0,
    ...over,
  };
}

const proposed: ContainmentDto = {
  id: 'c1',
  incidentId: 'a1',
  entityKind: 'network',
  entityKey: 'v1:abc',
  action: 'contain',
  status: 'proposed',
  approvalsRequired: 1,
  approvals: [],
  decision: {
    action: 'contain',
    reasons: ['attack_supported_at_0.80'],
    refusals: [],
    approvalsRequired: 1,
    expiresAfterMinutes: 30,
    expectedCost: { ifWeAct: 100, ifWeWait: 5000, currency: 'INR' },
    policyVersion: 1,
    policyHash: 'aaaa1111',
  },
  policyVersion: 1,
  policyHash: 'aaaa1111',
  proposedBy: 'Ana',
  proposedAt: T,
  activatedAt: null,
  expiresAt: null,
  endedAt: null,
  extensions: 0,
  history: [{ kind: 'proposed', actor: 'Ana', note: 'card testing', at: T }],
};

const auditEntry: AuditEntry = {
  seq: 9,
  at: T,
  actor: 'Ana',
  kind: 'recommendation.accepted',
  subjectType: 'incident',
  subjectId: 'a1',
  payload: {
    action: 'contain',
    alignment: 'aligned',
    reasoningVersion: 'rm-r1',
    groundingHash: 'abc123def456',
  },
  policyVersion: 1,
  policyHash: 'aaaa1111',
  hash: 'ffff9999',
  prevHash: 'eeee8888',
};

function stubRoutes(
  over: {
    recommendation?: RiskRecommendation | null;
    containments?: ContainmentDto[];
    audit?: AuditEntry[];
  } = {},
): ReturnType<typeof vi.fn> {
  const rec = 'recommendation' in over ? over.recommendation : recommendation();
  const body = (u: string): unknown => {
    if (u.includes('/recommendation/accept'))
      return { action: 'contain', outcome: 'containment_proposed', refusals: [], status: null };
    if (u.includes('/recommendation')) return { recommendation: rec };
    if (u.includes('/containments')) return { containments: over.containments ?? [] };
    if (u.includes('/audit')) return { entries: over.audit ?? [] };
    return {};
  };
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => body(String(url)),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const incident = (over: Partial<IncidentDetail> = {}): IncidentDetail =>
  ({ id: 'a1', status: 'open', history: [], ...over }) as IncidentDetail;

function renderTab(inc: IncidentDetail = incident()): void {
  render(
    wrap(
      <ActionsAuditTab
        incident={inc}
        onResolve={() => {}}
        resolvePending={false}
        resolveError={null}
      />,
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ActionsAuditTab', () => {
  it('renders the backend recommendation — action, grounded reasons, alignment and source', async () => {
    stubRoutes();
    renderTab();
    expect(await screen.findByText('Block suspicious activity')).toBeInTheDocument();
    expect(screen.getByText(/36 different cards from one network/)).toBeInTheDocument();
    expect(screen.getByText('Aligned')).toBeInTheDocument();
    expect(screen.getByText('Local model')).toBeInTheDocument(); // source tier, not "Groq" without a key
    expect(screen.getByText('rm-r1')).toBeInTheDocument();
  });

  it('takes the recommended action through the accept endpoint with the grounding hash', async () => {
    const fetchMock = stubRoutes();
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: /Block suspicious activity/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/incidents/a1/recommendation/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ groundingHash: 'abc123def456' }),
      }),
    );
  });

  it('builds the action history from real containment and transition records', async () => {
    stubRoutes({
      containments: [proposed],
      audit: [],
    });
    renderTab(
      incident({
        history: [{ from: 'open', to: 'under_review', actor: 'Ben', note: 'checking', at: T }],
      }),
    );
    expect(await screen.findByText('Propose containment')).toBeInTheDocument();
    expect(screen.getByText('Review incident')).toBeInTheDocument();
    expect(screen.getByText('Proposed')).toBeInTheDocument();
  });

  it('shows the audit log with the AI-recommendation provenance', async () => {
    stubRoutes({ audit: [auditEntry] });
    renderTab();
    expect(await screen.findByText('AI recommendation accepted')).toBeInTheDocument();
    expect(screen.getByText('RECOMMENDATION_ACCEPTED')).toBeInTheDocument();
    // Provenance (reasoning version + short grounding hash) is shown, from the payload.
    expect(screen.getByText(/rm-r1 · abc123de/)).toBeInTheDocument();
  });

  it('disables Take action on a closed incident', async () => {
    stubRoutes();
    renderTab(incident({ status: 'resolved' }));
    expect(await screen.findByRole('button', { name: /Block suspicious activity/ })).toBeDisabled();
  });
});
