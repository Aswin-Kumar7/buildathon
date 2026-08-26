import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IncidentDetail, ModelOpinion as ModelOpinionDto } from '@sentinel/contracts';
import { ModelOpinion } from './ModelOpinion.js';

// The component reads only these two fields; the cast keeps the fixture honest about that.
const asDetail = (
  fields: Pick<IncidentDetail, 'modelAvailable' | 'modelOpinion'>,
): IncidentDetail => fields as IncidentDetail;

const opinion = (over: Partial<ModelOpinionDto> = {}): ModelOpinionDto => ({
  predictedClass: 'attack',
  confidence: 0.91,
  abstained: false,
  probabilities: [
    { label: 'attack', probability: 0.91 },
    { label: 'outage', probability: 0.05 },
    { label: 'retry_storm', probability: 0.03 },
    { label: 'healthy_traffic', probability: 0.01 },
  ],
  contributions: [
    { feature: 'cards_per_attempt', contribution: 1.42 },
    { feature: 'failure_rate', contribution: 0.88 },
  ],
  modelVersion: 'b1',
  ...over,
});

describe('ModelOpinion', () => {
  it('says the decision ran on rules alone when the model is unavailable', () => {
    render(<ModelOpinion incident={asDetail({ modelAvailable: false, modelOpinion: null })} />);
    expect(screen.getByText(/degraded:model/i)).toBeInTheDocument();
    // The point that must land: absence degrades the explanation, not the action.
    expect(screen.getByText(/never allowed to be it/i)).toBeInTheDocument();
  });

  it('says an incident was not scored when the model is present but the opinion is null', () => {
    render(<ModelOpinion incident={asDetail({ modelAvailable: true, modelOpinion: null })} />);
    expect(screen.getByText(/not scored/i)).toBeInTheDocument();
  });

  it('shows the call, the distribution and the per-feature reasons', () => {
    render(<ModelOpinion incident={asDetail({ modelAvailable: true, modelOpinion: opinion() })} />);
    expect(screen.getByText(/91% confident/i)).toBeInTheDocument();
    // The full distribution is the calibration band, not just the winner.
    expect(screen.getByText(/outage/i)).toBeInTheDocument();
    // Contributions are rendered in human words, strongest first.
    expect(screen.getByText(/cards per attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/\+1\.42/)).toBeInTheDocument();
  });

  it('marks an abstention rather than asserting a low-confidence class', () => {
    render(
      <ModelOpinion
        incident={asDetail({
          modelAvailable: true,
          modelOpinion: opinion({ abstained: true, confidence: 0.41 }),
        })}
      />,
    );
    expect(screen.getByText(/abstained/i)).toBeInTheDocument();
    expect(screen.getByText(/below the abstain bar/i)).toBeInTheDocument();
  });
});
