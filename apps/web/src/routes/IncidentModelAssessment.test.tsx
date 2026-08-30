import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { IncidentDetail, ModelOpinion } from '@sentinel/contracts';
import { ModelAssessmentTab } from './IncidentModelAssessment.js';

// The tab reads only these fields off the detail payload; the cast keeps the fixture honest.
const asDetail = (
  fields: Pick<IncidentDetail, 'modelAvailable' | 'modelOpinion'> &
    Partial<Pick<IncidentDetail, 'arbitration' | 'entityKind' | 'score' | 'band'>>,
): IncidentDetail =>
  ({
    entityKind: 'session',
    score: 0.9,
    band: 'high',
    scoreLower: 0.9,
    scoreUpper: 0.9,
    ...fields,
  }) as IncidentDetail;

const opinion = (over: Partial<ModelOpinion> = {}): ModelOpinion => ({
  risk: 0.91,
  predictedClass: 'abuse',
  band: 'contain_eligible',
  abstained: false,
  probabilities: [
    { label: 'benign', probability: 0.09 },
    { label: 'abuse', probability: 0.91 },
  ],
  contributions: [
    { feature: 'cards_per_attempt', contribution: 1.42 },
    { feature: 'approval_rate', contribution: -0.6 },
    { feature: 'failure_rate', contribution: 0.88 },
  ],
  modelVersion: 'r1',
  ...over,
});

const registry = {
  version: 'r1',
  trainingDataHash: 'sha256:abcdef0123456789',
  featureDefinitionVersion: 'fd-2',
  onnxExported: true,
  metricsSnapshot: { prAuc: 0.842, precision: 0.91, recall: 0.78 },
};

function wrap(ui: ReactNode): React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ available: true, registry }),
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModelAssessmentTab', () => {
  it('shows an honest unavailable state — never 0% — when the model is not loaded', () => {
    render(
      wrap(
        <ModelAssessmentTab
          incident={asDetail({ modelAvailable: false, modelOpinion: null })}
          onViewEvidence={() => {}}
        />,
      ),
    );
    expect(screen.getByText(/degraded:model/i)).toBeInTheDocument();
    expect(screen.getByText(/not treated as low risk/i)).toBeInTheDocument();
    // No fabricated gauge in the unavailable state.
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('says the incident was not scored when the model is present but produced no opinion', () => {
    render(
      wrap(
        <ModelAssessmentTab
          incident={asDetail({ modelAvailable: true, modelOpinion: null })}
          onViewEvidence={() => {}}
        />,
      ),
    );
    expect(screen.getByText(/did not score this incident/i)).toBeInTheDocument();
  });

  it('shows the canonical incident score in the gauge, consistent with the header', () => {
    render(
      wrap(
        <ModelAssessmentTab
          incident={asDetail({ modelAvailable: true, modelOpinion: opinion() })}
          onViewEvidence={() => {}}
        />,
      ),
    );
    expect(screen.getByText('High risk')).toBeInTheDocument();
    // The model's own read is surfaced as a clearly-labelled secondary stat.
    expect(screen.getByText('Estimated abuse risk')).toBeInTheDocument();
    expect(screen.getAllByText('91%').length).toBeGreaterThan(0);
  });

  it('renders the real signed contributions, not invented categories', () => {
    render(
      wrap(
        <ModelAssessmentTab
          incident={asDetail({ modelAvailable: true, modelOpinion: opinion() })}
          onViewEvidence={() => {}}
        />,
      ),
    );
    // Human-readable feature labels + signed values from the model itself.
    expect(screen.getAllByText('Cards per attempt').length).toBeGreaterThan(0);
    expect(screen.getByText('+1.42')).toBeInTheDocument();
    expect(screen.getByText('-0.60')).toBeInTheDocument();
  });

  it('explains leading with the canonical score, then the model’s read and influence', () => {
    render(
      wrap(
        <ModelAssessmentTab
          incident={asDetail({
            modelAvailable: true,
            modelOpinion: opinion(),
            arbitration: { modelInfluence: 'escalated' } as IncidentDetail['arbitration'],
          })}
          onViewEvidence={() => {}}
        />,
      ),
    );
    // Leads with the canonical incident score (matches the header), then the model's own read.
    expect(screen.getByText(/scored 90\/100 \(high risk\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/escalated a case the rules alone would have let pass/i),
    ).toBeInTheDocument();
  });

  it('routes to the evidence tab via real navigation', () => {
    const onView = vi.fn();
    render(
      wrap(
        <ModelAssessmentTab
          incident={asDetail({ modelAvailable: true, modelOpinion: opinion() })}
          onViewEvidence={onView}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /view signal evidence/i }));
    expect(onView).toHaveBeenCalledOnce();
  });
});
