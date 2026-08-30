import { useQuery } from '@tanstack/react-query';
import { simulationRunsResponseSchema, type SimulationRun } from '@sentinel/contracts';

/**
 * Past simulation runs, shown on the Incidents list itself.
 *
 * Read from the durable `simulation_runs` log (GET /api/simulation/runs): a snapshot of what each
 * run detected, kept independently of the live incident table — so it survives the per-scenario
 * reset. Lives here (not in the simulation panel) so a merchant can see the history alongside the
 * incidents it produced, without opening the run panel.
 */
async function fetchRuns(): Promise<SimulationRun[]> {
  const response = await fetch('/api/simulation/runs', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return simulationRunsResponseSchema.parse(await response.json()).runs;
}

const CAT_TONE: Record<string, string> = {
  attack: 'attack',
  operational: 'operational',
  benign: 'benign',
  mixed: 'neutral',
};
const bucketOf = (severity: string, score: number): string =>
  severity === 'high' && score >= 0.9 ? 'critical' : severity;
const clock = (ms: number): string =>
  new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function RunHistory(): React.JSX.Element {
  const runs = useQuery({
    queryKey: ['simulation-runs'],
    queryFn: fetchRuns,
    refetchInterval: 4000,
  });
  const list = runs.data ?? [];
  return (
    <section className="inct-panel incp-runs" aria-label="Run history">
      <div className="incp-runs__head">
        <h3>Run history</h3>
        <p>Past simulation runs — kept even after a scenario resets its incident data.</p>
      </div>
      {list.length === 0 ? (
        <p className="simpanel-none">No simulations run yet — start one from “Run simulation”.</p>
      ) : (
        <ol className="simpanel-runs">
          {list.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </ol>
      )}
    </section>
  );
}

function RunRow({ run }: { run: SimulationRun }): React.JSX.Element {
  return (
    <li className="simpanel-run">
      <div className="simpanel-run__head">
        <span
          className={`simpanel-run__cat simpanel-run__cat--${CAT_TONE[run.classification] ?? 'neutral'}`}
        >
          {run.classification}
        </span>
        <strong>{run.scenarioTitle}</strong>
        <span className="simpanel-run__time">{clock(Date.parse(run.startedAt))}</span>
      </div>
      <p className="simpanel-run__meta">
        {run.paymentsGenerated} payments · {run.incidentsDetected}{' '}
        {run.incidentsDetected === 1 ? 'incident' : 'incidents'} detected
        {run.status === 'running' && ' · running'}
      </p>
      {run.detected.length > 0 ? (
        <ul className="simpanel-run__det">
          {run.detected.map((incident, index) => (
            <li key={`${run.id}-${index}`}>
              <i
                className={`simpanel-run__dot simpanel-run__dot--${bucketOf(incident.severity, incident.score)}`}
                aria-hidden="true"
              />
              {incident.title} · {Math.round(incident.score * 100)}/100
            </li>
          ))}
        </ul>
      ) : (
        run.status !== 'running' && <p className="simpanel-run__none">No incident detected</p>
      )}
    </li>
  );
}
