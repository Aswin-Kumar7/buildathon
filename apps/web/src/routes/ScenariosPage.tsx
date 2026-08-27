import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, PageHeader } from '@sentinel/ui';
import {
  replayResultSchema,
  scenarioListResponseSchema,
  type ScenarioListResponse,
  type ScenarioSummary,
} from '@sentinel/contracts';
import { csrfHeaders } from '../auth/api.js';
import './ScenariosPage.css';

async function fetchScenarios(): Promise<ScenarioListResponse> {
  const response = await fetch('/api/replay', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return scenarioListResponseSchema.parse(await response.json());
}

async function runScenario(family: string) {
  const response = await fetch('/api/replay', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ family }),
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return replayResultSchema.parse(await response.json());
}

async function clearReplayed(): Promise<void> {
  const response = await fetch('/api/replay', {
    method: 'DELETE',
    credentials: 'include',
    headers: csrfHeaders(),
  });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
}

const TONE = { benign: 'ok', operational: 'warn', attack: 'critical' } as const;

function Scenario({
  scenario,
  onRun,
  running,
}: {
  scenario: ScenarioSummary;
  onRun: (family: string) => void;
  running: boolean;
}): React.JSX.Element {
  return (
    <Card title={scenario.title}>
      <div className="scenario__head">
        <Badge tone={TONE[scenario.classification]}>{scenario.classification}</Badge>
        <code>{scenario.family}</code>
      </div>

      <p className="scenario__narrative">{scenario.narrative}</p>

      <dl className="scenario__facts">
        <div>
          <dt>Correlates on</dt>
          <dd>{scenario.correlation}</dd>
        </div>
        <div>
          <dt>Right answer</dt>
          <dd>{scenario.recommendedAction}</dd>
        </div>
        {/*
          Kept on the card rather than buried in a document. A scenario nobody can see the
          point of is a scenario that gets quietly dropped when it starts failing.
        */}
        <div>
          <dt>Why it is hard</dt>
          <dd>{scenario.difficulty}</dd>
        </div>
      </dl>

      {/*
        Named for the scenario, not "Replay this". Eight identically-labelled buttons tell a
        screen reader user nothing about which one they are on.
      */}
      <Button
        onClick={() => onRun(scenario.family)}
        disabled={running}
        aria-label={`Replay ${scenario.title}`}
      >
        {running ? 'Replaying…' : 'Replay this'}
      </Button>
    </Card>
  );
}

export function ScenariosPage(): React.JSX.Element {
  const client = useQueryClient();
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: fetchScenarios });

  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['scenarios'] });
    await client.invalidateQueries({ queryKey: ['attempts'] });
  };

  const run = useMutation({ mutationFn: runScenario, onSuccess: invalidate });
  const clear = useMutation({ mutationFn: clearReplayed, onSuccess: invalidate });

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Simulation"
        description="Replay any of eight labelled traffic shapes through the real ingestion path — the same signature-free insert, encryption, drain and state resolution live traffic takes. Fire an attack, then watch the console light up."
      />

      {scenarios.isError && (
        <Callout tone="critical" title="Could not read the scenario catalogue">
          <p role="alert">{scenarios.error.message}</p>
        </Callout>
      )}

      {run.isError && (
        <Callout tone="critical" title="Replay failed">
          <p role="alert">{run.error.message}</p>
        </Callout>
      )}

      {scenarios.data !== undefined && (
        <Callout tone="neutral" title="Synthetic events are counted separately">
          <p>
            <strong>{scenarios.data.counts.razorpay}</strong> events from Razorpay,{' '}
            <strong>{scenarios.data.counts.replay}</strong> replayed. They are marked apart at the
            row, because a demo that inflated the real numbers would make every claim about
            ingestion worthless.
          </p>
          <Button
            variant="secondary"
            onClick={() => clear.mutate()}
            disabled={clear.isPending || scenarios.data.counts.replay === 0}
          >
            {clear.isPending ? 'Clearing…' : 'Remove replayed events'}
          </Button>
        </Callout>
      )}

      {run.data !== undefined && (
        <Callout tone="ok" title={`Replayed ${run.data.family}`}>
          <p>
            {run.data.eventsWritten} events and {run.data.checkoutsWritten} checkouts written
            {run.data.duplicatesSkipped > 0 &&
              `, ${run.data.duplicatesSkipped} already present and skipped`}
            . Detection evaluated {run.data.detection.evaluated} entities, opened{' '}
            {run.data.detection.opened} incidents, and updated {run.data.detection.updated}. Open{' '}
            <strong>Incidents</strong> to review the decision and take action.
          </p>
        </Callout>
      )}

      {scenarios.isPending && <p role="status">Reading the scenario catalogue…</p>}

      <section className="scenarios">
        {scenarios.data?.scenarios.map((scenario) => (
          <Scenario
            key={scenario.family}
            scenario={scenario}
            onRun={(family) => run.mutate(family)}
            running={run.isPending && run.variables === scenario.family}
          />
        ))}
      </section>
    </>
  );
}
