import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IncidentDetail } from '@sentinel/contracts';
import { EvidenceSignalsTab } from './IncidentEvidence.js';

const T0 = Date.parse('2026-03-01T09:00:00.000Z');

function detail(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: 'a1',
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
    firedRules: ['card_spread', 'approval_collapse', 'small_amount_probing'],
    recommendedDecision: 'review',
    primaryHypothesis: 'attack',
    attempts: 36,
    failures: 36,
    distinctCards: 36,
    title: 'Distributed card testing',
    evidence: [
      {
        rule: 'card_spread',
        code: 'distinct_cards_above_threshold',
        observed: 36,
        threshold: 8,
        weight: 0.35,
      },
      {
        rule: 'approval_collapse',
        code: 'approval_rate_below_floor',
        observed: 0.03,
        threshold: 0.2,
        weight: 0.25,
      },
      {
        rule: 'small_amount_probing',
        code: 'small_amount_share_above_threshold',
        observed: 0.9,
        threshold: 0.6,
        weight: 0.15,
      },
      {
        rule: 'recovery',
        code: 'orders_recovered_after_failure',
        observed: 2,
        threshold: 0,
        weight: -0.4,
      },
    ],
    abstentions: [{ rule: 'machine_cadence', reason: 'insufficient-data' }],
    change: null,
    arbitration: null,
    modelOpinion: null,
    modelAvailable: true,
    label: null,
    labelSource: null,
    thresholdHash: 'a1b2c3d4',
    history: [],
    relatedOrders: [],
    graph: {
      entity: { kind: 'network', fingerprint: '32c1532c' },
      cards: [{ fingerprint: 'ab12cd34', network: 'Visa', attempts: 1, captured: false }],
      sessions: [{ fingerprint: 's1', cards: 1 }],
    },
    ...overrides,
  };
}

describe('EvidenceSignalsTab', () => {
  it('renders each triggered rule with its observed value, threshold and impact', () => {
    render(<EvidenceSignalsTab it={detail()} />);

    // Strongest incriminating signal, formatted in its natural unit.
    expect(screen.getByText('Many different cards were tried')).toBeInTheDocument();
    expect(screen.getByText('36 cards')).toBeInTheDocument();
    expect(screen.getByText('≥ 8 cards')).toBeInTheDocument();
    // Approval collapse renders as a percentage against a floor.
    expect(screen.getByText('Almost all payments failed')).toBeInTheDocument();
    expect(screen.getByText('3%')).toBeInTheDocument();
    expect(screen.getByText('≤ 20%')).toBeInTheDocument();
  });

  it('derives impact tiers from the real signed weights, not an invented score', () => {
    render(<EvidenceSignalsTab it={detail()} />);
    // weight 0.35 -> High; 0.25 and 0.15 -> Medium; none Low.
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Medium').length).toBeGreaterThanOrEqual(1);
  });

  it('shows mitigating signals and abstentions honestly, without hiding them', () => {
    render(<EvidenceSignalsTab it={detail()} />);
    expect(screen.getByText(/Argued against flagging/)).toBeInTheDocument();
    expect(screen.getByText(/A customer paid after a failed try/)).toBeInTheDocument();
    expect(screen.getByText(/Not enough data to judge/)).toBeInTheDocument();
  });

  it('renders behavioural signals only from backend-supported values', () => {
    render(<EvidenceSignalsTab it={detail()} />);
    expect(screen.getByText('Different cards')).toBeInTheDocument();
    expect(screen.getByText('Sessions involved')).toBeInTheDocument();
    // No fabricated BIN / geography / device rows.
    expect(screen.queryByText(/BIN/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Geograph/i)).not.toBeInTheDocument();
  });

  it('stays clean when an incident has no positively-fired rules', () => {
    render(<EvidenceSignalsTab it={detail({ evidence: [], abstentions: [], firedRules: [] })} />);
    expect(screen.getByText(/No unusual patterns stood out/)).toBeInTheDocument();
    // The behavioural table still renders the counts it does have.
    expect(screen.getByText('Different cards')).toBeInTheDocument();
  });
});
