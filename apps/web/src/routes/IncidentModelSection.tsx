import { useQuery } from '@tanstack/react-query';
import { Badge, Callout, Card } from '@sentinel/ui';
import { incidentModelResponseSchema, type IncidentModel } from '@sentinel/contracts';
import { hypothesisName } from '../incidents/evidence.js';

async function fetchIncidentModel() {
  const response = await fetch('/api/model/incident', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentModelResponseSchema.parse(await response.json());
}

const three = (v: number): string => v.toFixed(3);

function Confusion({ model }: { model: IncidentModel }): React.JSX.Element {
  return (
    <>
      <h3>Four-class confusion (rows: actual, columns: predicted)</h3>
      <div className="audit-table-wrap">
        <table className="metrics-table">
          <thead>
            <tr>
              <th>actual \ predicted</th>
              {model.classes.map((c) => (
                <th key={c}>{hypothesisName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.confusion.map((row, i) => (
              <tr key={model.classes[i]}>
                <td>{hypothesisName(model.classes[i]!)}</td>
                {row.map((value, j) => (
                  <td key={j} className={i === j && value > 0 ? 'is-inflated' : undefined}>
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Diagnostics({ model }: { model: IncidentModel }): React.JSX.Element {
  // A representative slice of the risk-coverage curve: a few thresholds showing the trade.
  const rc = model.riskCoverage.filter((_, i) => i % 5 === 0);
  return (
    <>
      <h3>Ablation ladder</h3>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Features</th>
            <th>Count</th>
            <th>Macro-F1</th>
          </tr>
        </thead>
        <tbody>
          {model.ablation.map((row) => (
            <tr key={row.features}>
              <td>{row.features}</td>
              <td>{row.nFeatures}</td>
              <td>{three(row.macroF1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="incident__band">
        Remove the traffic-context features and the outage-versus-attack distinction collapses — a
        per-entity view cannot tell them apart, and the ladder shows it rather than asserting it.
      </p>

      <h3>Risk–coverage (the abstain trade)</h3>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>Confidence bar</th>
            <th>Coverage</th>
            <th>Selective accuracy</th>
          </tr>
        </thead>
        <tbody>
          {rc.map((row) => (
            <tr key={row.threshold}>
              <td>{three(row.threshold)}</td>
              <td>{three(row.coverage)}</td>
              <td>{three(row.selectiveAccuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Model({ model }: { model: IncidentModel }): React.JSX.Element {
  return (
    <Card>
      <div className="metrics-head">
        <h2>Incident classifier (Model B)</h2>
        <Badge tone="neutral">v{model.registry.version}</Badge>
      </div>
      <p className="incident__band">
        Four decidable classes with an explicit abstain, served in the request path as a linear map.
        Grouped split — {model.splitGroupOverlap} scenarios shared between train and test. Registry
        feature definition <code>{model.registry.featureDefinitionVersion}</code>, training data{' '}
        <code>{model.registry.trainingDataHash}</code>.
      </p>

      <dl className="incident__facts">
        <div>
          <dt>Accuracy</dt>
          <dd>{three(model.accuracy)}</dd>
        </div>
        <div>
          <dt>Macro-F1</dt>
          <dd>{three(model.macroF1)}</dd>
        </div>
        <div>
          <dt>Abstain rate</dt>
          <dd>{three(model.abstainRate)}</dd>
        </div>
      </dl>

      {model.hardening.triggered && (
        <Callout tone="warn" title="Corpus hardening triggered">
          <p>
            The model scored macro-F1 {three(model.hardening.baseMacroF1)} — above the threshold, so
            the corpus was deemed too easy. It was hardened with feature noise and re-scored to{' '}
            {model.hardening.hardenedMacroF1 !== null
              ? three(model.hardening.hardenedMacroF1)
              : '—'}
            . That harder number is the honest one to quote.
          </p>
        </Callout>
      )}

      <Confusion model={model} />

      <Diagnostics model={model} />
    </Card>
  );
}

export function IncidentModelSection(): React.JSX.Element | null {
  const incidentModel = useQuery({ queryKey: ['incident-model'], queryFn: fetchIncidentModel });

  if (incidentModel.data === undefined) return null;
  if (incidentModel.data.available === false) {
    return (
      <Callout tone="neutral" title="The incident classifier has not been generated">
        <p>{incidentModel.data.reason}</p>
      </Callout>
    );
  }
  return <Model model={incidentModel.data.model} />;
}
