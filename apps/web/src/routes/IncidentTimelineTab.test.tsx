import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuditEntry, IncidentDetail } from '@sentinel/contracts';
import { IncidentTimelineTab } from './IncidentTimelineTab.js';

const T = Date.parse('2026-03-01T09:00:00.000Z');

const entries: AuditEntry[] = [
  {
    seq: 5,
    at: T + 400_000,
    actor: 'Ana',
    kind: 'recommendation.accepted',
    subjectType: 'incident',
    subjectId: 'a1',
    payload: {
      action: 'contain',
      alignment: 'aligned',
      reasoningVersion: 'rm-r1',
      groundingHash: 'abc12345def678',
    },
    policyVersion: null,
    policyHash: null,
    hash: 'hh1aaaaaaaa',
    prevHash: 'pp1',
  },
  {
    seq: 6,
    at: T + 500_000,
    actor: 'Ana',
    kind: 'containment.proposed',
    subjectType: 'containment',
    subjectId: 'c1',
    payload: { note: 'card testing' },
    policyVersion: 1,
    policyHash: 'ph1',
    hash: 'hh2bbbbbbbb',
    prevHash: 'hh1',
  },
  {
    seq: 7,
    at: T + 600_000,
    actor: 'Ana',
    kind: 'incident.transition',
    subjectType: 'incident',
    subjectId: 'a1',
    payload: { from: 'open', to: 'under_review' },
    policyVersion: null,
    policyHash: null,
    hash: 'hh3cccccccc',
    prevHash: 'hh2',
  },
];

function stub(list: AuditEntry[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ entries: list }) })),
  );
}

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const incident = (): IncidentDetail =>
  ({
    id: 'a1',
    firstAttemptAt: T,
    detectedAt: T + 300_000,
    timeToDetectMs: 300_000,
  }) as IncidentDetail;

afterEach(() => vi.unstubAllGlobals());

describe('IncidentTimelineTab', () => {
  it('builds the timeline from real audit events plus the incident anchors', async () => {
    stub(entries);
    render(wrap(<IncidentTimelineTab incident={incident()} />));

    // Real recorded events, human-labelled (await the async audit load first).
    expect(await screen.findByText('AI recommendation accepted')).toBeInTheDocument();
    expect(screen.getByText('Action proposed')).toBeInTheDocument();
    expect(screen.getByText('Incident moved')).toBeInTheDocument();
    // Lifecycle anchors from real incident fields.
    expect(screen.getByText('Incident detected')).toBeInTheDocument();
    expect(screen.getByText('First attempt in window')).toBeInTheDocument();
    // A backend-derived description, not fabricated.
    expect(screen.getByText(/recommendation \(contain\) accepted/i)).toBeInTheDocument();
  });

  it('expands an event to show only real backend fields', async () => {
    stub(entries);
    render(wrap(<IncidentTimelineTab incident={incident()} />));
    await screen.findByText('AI recommendation accepted');

    // The AI event's View details reveals its provenance from the audit payload.
    const aiCard = screen
      .getByText('AI recommendation accepted')
      .closest('.tl-card') as HTMLElement;
    await userEvent.click(aiCard.querySelector('.tl-details') as HTMLElement);

    expect(screen.getByText('Reasoning version')).toBeInTheDocument();
    expect(screen.getByText('rm-r1')).toBeInTheDocument();
    expect(screen.getByText('Provenance (grounding)')).toBeInTheDocument();
    expect(screen.getByText('abc12345def6')).toBeInTheDocument(); // sliced to 12 chars
  });

  it('filters the timeline by event category, actually changing the results', async () => {
    stub(entries);
    render(wrap(<IncidentTimelineTab incident={incident()} />));
    await screen.findByText('Action proposed');

    await userEvent.selectOptions(screen.getByLabelText('Event types'), 'ai');

    expect(screen.getByText('AI recommendation accepted')).toBeInTheDocument();
    // Non-AI events are filtered out.
    expect(screen.queryByText('Action proposed')).not.toBeInTheDocument();
    expect(screen.queryByText('Incident detected')).not.toBeInTheDocument();
  });

  it('shows a legend for the categories actually present', async () => {
    stub(entries);
    render(wrap(<IncidentTimelineTab incident={incident()} />));
    await screen.findByText('AI recommendation accepted'); // wait for the audit data to load

    const legend = screen.getByText('Legend').closest('.tl-legend') as HTMLElement;
    expect(legend).toHaveTextContent('AI recommendation');
    expect(legend).toHaveTextContent('Containment event');
    expect(legend).toHaveTextContent('Incident event');
  });
});
