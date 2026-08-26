import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { IncidentDetail, ModelOpinion as ModelOpinionDto } from '@sentinel/contracts';
import { ModelOpinion } from './ModelOpinion.js';

// The component reads only these fields; the cast keeps the fixture honest about that.
const asDetail = (
  fields: Pick<IncidentDetail, 'modelAvailable' | 'modelOpinion'> &
    Partial<Pick<IncidentDetail, 'arbitration'>>,
): IncidentDetail => fields as IncidentDetail;

const opinion = (over: Partial<ModelOpinionDto> = {}): ModelOpinionDto => ({
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
    { feature: 'failure_rate', contribution: 0.88 },
  ],
  modelVersion: 'r1',
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

  it('shows how the model moved the decision when it was a driver', () => {
    render(
      <ModelOpinion
        incident={asDetail({
          modelAvailable: true,
          modelOpinion: opinion(),
          arbitration: { modelInfluence: 'escalated' } as IncidentDetail['arbitration'],
        })}
      />,
    );
    // The model as a driver: it escalated a case the rules would have suppressed.
    expect(screen.getByText(/Model influence: escalated/i)).toBeInTheDocument();
    expect(screen.getByText(/would have let it pass/i)).toBeInTheDocument();
  });

  it('says plainly when the model did not move the decision', () => {
    render(<ModelOpinion incident={asDetail({ modelAvailable: true, modelOpinion: opinion() })} />);
    expect(screen.getByText(/did not move this decision/i)).toBeInTheDocument();
  });

  it('shows the risk, the distribution and the per-feature reasons', () => {
    render(<ModelOpinion incident={asDetail({ modelAvailable: true, modelOpinion: opinion() })} />);
    // "risk 91%" appears in both the badge and the sentence — either is fine, both must be there.
    expect(screen.getAllByText(/risk 91%/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/reads this as abuse/i)).toBeInTheDocument();
    // The two-class distribution is the calibration band, not just the call.
    expect(screen.getByText(/benign/i)).toBeInTheDocument();
    // Contributions are rendered in human words, strongest first.
    expect(screen.getByText(/cards per attempt/i)).toBeInTheDocument();
    expect(screen.getByText(/\+1\.42/)).toBeInTheDocument();
  });

  it('marks a borderline risk as one the model would defer on', () => {
    render(
      <ModelOpinion
        incident={asDetail({
          modelAvailable: true,
          modelOpinion: opinion({ abstained: true, risk: 0.05, band: 'review' }),
        })}
      />,
    );
    expect(screen.getByText(/review band/i)).toBeInTheDocument();
    expect(screen.getByText(/defer to a person/i)).toBeInTheDocument();
  });
});
