import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ComparisonCase, ComparisonResponse } from '@sentinel/contracts';
import { ComparePage } from './ComparePage.js';
import { costPhrase, expectationPhrase, hypothesisName } from '../incidents/evidence.js';

function fits(best: ComparisonCase['arbitration']['best']) {
  const others = (
    ['attack', 'outage', 'retry_storm', 'healthy_traffic', 'insufficient_evidence'] as const
  ).filter((h) => h !== best);

  return [
    {
      hypothesis: best,
      support: 0.9,
      probability: 0.6,
      expectations: [
        { code: 'many_distinct_cards', observed: 40, expected: 8, met: true, weight: 2 },
        { code: 'small_amounts', observed: 0.1, expected: 0.6, met: false, weight: 1 },
      ],
    },
    ...others.map((hypothesis, index) => ({
      hypothesis,
      support: 0.2,
      probability: index === 0 ? 0.2 : 0.0667,
      expectations: [],
    })),
  ];
}

function makeCase(overrides: Partial<ComparisonCase> = {}): ComparisonCase {
  const best = overrides.arbitration?.best ?? 'attack';

  return {
    family: 'attack_loud',
    title: 'Card enumeration, undisguised',
    classification: 'attack',
    entityKind: 'session',
    attempts: 63,
    failures: 61,
    distinctCards: 63,
    approvalRate: 0.03,
    traffic: {
      attempts: 63,
      failures: 61,
      approvalRate: 0.03,
      infrastructureFailureShare: 0,
      failingSessions: 1,
      activeSessions: 1,
      topSessionFailureShare: 1,
    },
    arbitration: {
      best,
      runnerUp: 'insufficient_evidence',
      margin: 0.4,
      fits: fits(best),
      decision: 'contain',
      abstained: false,
      reasons: ['attack_clearly_best_supported'],
    },
    counterfactual: {
      hypothesis: best,
      ifWrongToAct: 'blocked_a_real_shopper',
      ifWrongToWait: 'card_testing_continues_and_chargebacks_follow',
    },
    ...overrides,
  };
}

function response(): ComparisonResponse {
  return {
    cases: [
      makeCase(),
      makeCase({
        family: 'gateway_outage',
        title: 'Acquirer outage',
        classification: 'operational',
        entityKind: 'network',
        traffic: {
          attempts: 119,
          failures: 29,
          approvalRate: 0.76,
          infrastructureFailureShare: 1,
          failingSessions: 29,
          activeSessions: 59,
          topSessionFailureShare: 0.03,
        },
        arbitration: {
          best: 'outage',
          runnerUp: 'healthy_traffic',
          margin: 0.3,
          fits: fits('outage'),
          decision: 'monitor',
          abstained: false,
          reasons: ['suppressed_by_outage'],
        },
        counterfactual: {
          hypothesis: 'outage',
          ifWrongToAct: 'punished_customers_for_an_acquirer_outage',
          ifWrongToWait: 'nothing_extra_the_outage_is_not_ours_to_fix',
        },
      }),
      makeCase({
        family: 'retry_storm',
        title: 'Legitimate dunning',
        classification: 'operational',
        arbitration: {
          best: 'retry_storm',
          runnerUp: 'healthy_traffic',
          margin: 0.25,
          fits: fits('retry_storm'),
          decision: 'none',
          abstained: false,
          reasons: ['suppressed_by_retry_storm'],
        },
        counterfactual: {
          hypothesis: 'retry_storm',
          ifWrongToAct: 'stopped_a_merchant_collecting_money_it_is_owed',
          ifWrongToWait: 'nothing_extra_the_schedule_completes',
        },
      }),
    ],
    thresholdHash: 'a1b2c3d4',
  };
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function stub(body: ComparisonResponse): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
}

describe('ComparePage', () => {
  it('shows three different decisions from one set of thresholds', async () => {
    // The slice's exit condition, on the page. A reader sees three identical layouts reach three
    // conclusions — a claim that cannot be made convincingly in a sentence.
    stub(response());
    render(wrap(<ComparePage />));

    expect(await screen.findByText('Contain')).toBeInTheDocument();
    expect(screen.getByText('Watch, do not act')).toBeInTheDocument();
    expect(screen.getByText('Leave alone')).toBeInTheDocument();
  });

  it('shows the shop around each entity, not just the entity', async () => {
    // The half that separates them. Without it all three are one entity failing repeatedly.
    stub(response());
    render(wrap(<ComparePage />));

    expect(await screen.findAllByText('The shop around it')).toHaveLength(3);
    expect(screen.getAllByText('Gateway blamed')).toHaveLength(3);
  });

  it('names every explanation it weighed, and what the winner beat', async () => {
    stub(response());
    render(wrap(<ComparePage />));

    expect(await screen.findAllByText(/Card testing/)).not.toHaveLength(0);
    expect(screen.getAllByText(/Acquirer outage/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Beat .* by \d+ points/).length).toBe(3);
  });

  it('shows what the winning explanation expected and did not get', async () => {
    stub(response());
    render(wrap(<ComparePage />));

    expect(await screen.findAllByText(/many different cards/)).toHaveLength(3);
    // An unmet expectation is shown too — a hypothesis that fits perfectly is rare, and hiding
    // the misses would make every verdict look inevitable.
    expect(screen.getAllByText(/trivial amounts/)).toHaveLength(3);
  });

  it('costs the wrong call in both directions', async () => {
    stub(response());
    render(wrap(<ComparePage />));

    expect(await screen.findByText(/a real shopper is blocked at checkout/)).toBeInTheDocument();
    expect(
      screen.getByText(/customers are punished for an outage that is not theirs or ours/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a merchant is stopped from collecting money it is owed/),
    ).toBeInTheDocument();
  });

  it('surfaces a failure rather than an empty page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    render(wrap(<ComparePage />));

    expect(await screen.findByRole('alert')).toHaveTextContent('api returned 500');
  });
});

describe('rendering arbitration', () => {
  it('gives each explanation a name a person would use', () => {
    expect(hypothesisName('retry_storm')).toBe('Biller retrying');
    expect(hypothesisName('healthy_traffic')).toBe('Ordinary traffic');
  });

  it('still renders an expectation nobody has worded', () => {
    const rendered = expectationPhrase({ code: 'some_new_expectation', observed: 5, expected: 2 });

    expect(rendered).toContain('5');
    expect(rendered).toContain('2');
  });

  it('still renders a cost nobody has worded', () => {
    expect(costPhrase('some_new_cost_code')).toBe('some new cost code');
  });
});
