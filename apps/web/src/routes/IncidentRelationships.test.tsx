import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IncidentDetail, ResolvedOrder } from '@sentinel/contracts';
import { RelationshipsTab } from './IncidentRelationships.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

function order(
  id: string,
  status: string,
  device: string,
  session: string,
  ip: string,
): ResolvedOrder {
  return {
    razorpayOrderId: id,
    source: 'replay',
    outcome: status === 'captured' ? 'paid' : 'failed',
    recovered: false,
    amountPaise: 1000,
    firstSeenAt: new Date(T0).toISOString(),
    lastSeenAt: new Date(T0 + 1000).toISOString(),
    failureCount: status === 'failed' ? 1 : 0,
    attempts: [
      {
        razorpayPaymentId: `pay_${id}`,
        status: status as ResolvedOrder['attempts'][number]['status'],
        amountPaise: 1000,
        method: 'card',
        cardNetwork: 'visa',
        cardIssuer: 'HDFC',
        cardFingerprint: null,
        failure: null,
        firstSeenAt: new Date(T0).toISOString(),
        lastSeenAt: new Date(T0 + 1000).toISOString(),
        eventCount: 1,
        late: false,
      },
    ],
    sensor: {
      sessionFingerprint: session,
      deviceFingerprint: device,
      ipFingerprint: ip,
      userAgentFamily: 'chrome',
      itemCount: 1,
      createdAt: new Date(T0).toISOString(),
    },
  };
}

function detail(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: 'a1b2c3',
    key: 'network:v1:abcdef:1',
    entityKind: 'network',
    entityKey: 'v1:abcdef0123456789',
    status: 'open',
    severity: 'high',
    score: 0.9,
    scoreLower: 0.9,
    scoreUpper: 0.9,
    band: 'high',
    firstAttemptAt: T0,
    detectedAt: T0 + 17_000,
    lastActivityAt: T0 + 83_000,
    expiresAt: T0 + 2_000_000,
    timeToDetectMs: 17_000,
    observations: 1,
    source: 'replay',
    firedRules: ['card_spread'],
    recommendedDecision: 'review',
    primaryHypothesis: 'attack',
    attempts: 3,
    failures: 2,
    distinctCards: 2,
    title: 'Distributed card testing',
    evidence: [],
    abstentions: [],
    change: null,
    arbitration: null,
    modelOpinion: null,
    modelAvailable: true,
    label: null,
    labelSource: null,
    thresholdHash: 'a1b2c3d4',
    history: [],
    relatedOrders: [
      order('o1', 'failed', 'd1', 's1', 'ip1'),
      order('o2', 'failed', 'd2', 's2', 'ip1'),
      order('o3', 'captured', 'd1', 's1', 'ip1'),
    ],
    graph: {
      entity: { kind: 'network', fingerprint: '32c1532c' },
      cards: [
        { fingerprint: 'ab12cd34', network: 'Visa', attempts: 2, captured: false },
        { fingerprint: 'ef56gh78', network: 'RuPay', attempts: 1, captured: true },
      ],
      sessions: [
        { fingerprint: 's1', cards: 1 },
        { fingerprint: 's2', cards: 1 },
      ],
    },
    ...overrides,
  };
}

describe('RelationshipsTab', () => {
  it('renders the incident, its correlated entity, cards and attempts from the backend graph', () => {
    render(<RelationshipsTab it={detail()} />);
    expect(screen.getByText('INC-A1B2')).toBeInTheDocument();
    expect(screen.getByText('Network (1)')).toBeInTheDocument();
    expect(screen.getByText('Cards (2)')).toBeInTheDocument();
    expect(screen.getByText('Attempts (3)')).toBeInTheDocument();
    // The real network fingerprint, never an IP address.
    expect(screen.getByText('32c1532c')).toBeInTheDocument();
  });

  it('adapts the context node to the entity kind (sessions for a network incident)', () => {
    render(<RelationshipsTab it={detail()} />);
    // Network incident → the sessions those cards came through are the context node.
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
  });

  it('shows a network context node for a device incident, derived from real sensors', () => {
    render(
      <RelationshipsTab
        it={detail({
          entityKind: 'device',
          graph: {
            entity: { kind: 'device', fingerprint: '70d135bc' },
            cards: [{ fingerprint: 'ab12cd34', network: 'Visa', attempts: 2, captured: false }],
            sessions: [],
          },
        })}
      />,
    );
    expect(screen.getByText('Device (1)')).toBeInTheDocument();
    // one distinct ipFingerprint across the related orders.
    expect(screen.getAllByText('Network').length).toBeGreaterThan(0);
  });

  it('surfaces relationship insights grounded in the data', () => {
    render(<RelationshipsTab it={detail()} />);
    expect(screen.getByText('Many cards from one network')).toBeInTheDocument();
    expect(screen.getByText(/2 different cards were tried/)).toBeInTheDocument();
    expect(screen.getByText('Most payments failed')).toBeInTheDocument();
    expect(screen.getByText(/67% of these payment attempts failed/)).toBeInTheDocument();
    expect(screen.getByText('All from the same source')).toBeInTheDocument();
  });

  it('uses the incident authoritative counts, not the (possibly capped) related-orders subset', () => {
    // The incident was decided on 50 attempts / 40 failures, but only 3 orders are linked at read
    // time. The headline counts must be the authoritative 50/80%, not the 3-order subset.
    render(<RelationshipsTab it={detail({ attempts: 50, failures: 40 })} />);
    expect(screen.getByText('Attempts (50)')).toBeInTheDocument();
    expect(screen.getByText(/80% of these payment attempts failed/)).toBeInTheDocument();
    // The status breakdown is honestly labelled as the resolved subset (3 linked, not 50).
    expect(screen.getByText(/3 resolved/)).toBeInTheDocument();
  });

  it('never fabricates IP, ASN, BIN or card last-four', () => {
    render(<RelationshipsTab it={detail()} />);
    expect(screen.queryByText(/ASN/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bBIN\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/IP address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/•••• \d{4}/)).not.toBeInTheDocument();
  });

  it('toggles to a list view of the same backend data', async () => {
    render(<RelationshipsTab it={detail()} />);
    await userEvent.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.getByText(/the entity this incident correlated on/)).toBeInTheDocument();
  });

  it('opens a detail popover from the entity node with only backend fields', async () => {
    render(<RelationshipsTab it={detail()} />);
    await userEvent.click(screen.getByRole('button', { name: /Network \(1\)/ }));
    expect(screen.getByText(/The network this incident correlated on/)).toBeInTheDocument();
  });

  it('stays clean when the incident has no linked cards or orders', () => {
    render(
      <RelationshipsTab
        it={detail({
          distinctCards: null,
          relatedOrders: [],
          graph: { entity: { kind: 'network', fingerprint: '32c1532c' }, cards: [], sessions: [] },
        })}
      />,
    );
    // Falls back to the incident's own attempt count with no fabricated breakdown, and no cards node.
    expect(screen.getByText('Attempts (3)')).toBeInTheDocument();
    expect(screen.queryByText(/Cards \(/)).not.toBeInTheDocument();
  });
});
