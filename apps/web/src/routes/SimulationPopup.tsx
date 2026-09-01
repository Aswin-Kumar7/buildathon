import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  scenarioListResponseSchema,
  simulationRunsResponseSchema,
  simulationStartResponseSchema,
  type ScenarioSummary,
  type SimulationRun,
} from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';
import { WarningCircle, Gear, Check } from '@phosphor-icons/react';

/** What the analyst should expect the detector to do — so a benign run is not read as a failure. */
const EXPECTATION: Record<
  ScenarioSummary['classification'],
  { tone: string; label: string; text: string }
> = {
  attack: {
    tone: 'attack',
    label: 'Should raise an incident',
    text: 'This is a card-testing attack. Expect Sentinel to correlate the attempts and open an incident.',
  },
  operational: {
    tone: 'operational',
    label: 'The hard case — should stay quiet',
    text: 'Legitimate operational activity — a biller’s dunning or a gateway wobble — that looks like card testing on raw failure volume. A well-tuned detector holds fire; this is exactly where false positives happen, so watch what Sentinel does.',
  },
  benign: {
    tone: 'benign',
    label: 'Should NOT raise an incident',
    text: 'This is ordinary, legitimate traffic. Expect no incident — it proves Sentinel does not over-flag real customers.',
  },
};

async function fetchScenarios(): Promise<ScenarioSummary[]> {
  const response = await fetch('/api/replay', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return scenarioListResponseSchema.parse(await response.json()).scenarios;
}

/** The scenarios already run, so the picker can mark them — re-running one just resets that one. */
async function fetchRuns(): Promise<SimulationRun[]> {
  const response = await fetch('/api/simulation/runs', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return simulationRunsResponseSchema.parse(await response.json()).runs;
}

async function startSimulation(family: string): Promise<void> {
  const response = await apiMutate('/api/simulation/start', { family });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `api returned ${response.status}`);
  }
  simulationStartResponseSchema.parse(await response.json());
}

/** Scenario cards per page in the picker — a neat 3×2 grid. */
const PAGE_SIZE = 6;

const CAT_TONE: Record<ScenarioSummary['classification'], string> = {
  attack: 'attack',
  operational: 'operational',
  benign: 'benign',
};

function CatIcon({ kind }: { kind: ScenarioSummary['classification'] }): React.JSX.Element {
  if (kind === 'attack') {
    return <WarningCircle size={16} />;
  }
  if (kind === 'operational') {
    return <Gear size={16} />;
  }
  return <Check size={16} />;
}

export function SimulationPopup({
  disabled,
  onClose,
  onStarted,
}: {
  disabled: boolean;
  onClose: () => void;
  onStarted: (family: string) => void;
}): React.JSX.Element {
  const scenarios = useQuery({ queryKey: ['scenarios'], queryFn: fetchScenarios });
  const runs = useQuery({ queryKey: ['simulation-runs'], queryFn: fetchRuns });
  const runFamilies = new Set((runs.data ?? []).map((run) => run.family));
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const start = useMutation({
    mutationFn: () => startSimulation(selected!),
    onSuccess: () => onStarted(selected!),
  });

  // Escape closes the modal, the usual dialog affordance.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = scenarios.data ?? [];
  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const shown = list.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const chosen = list.find((scenario) => scenario.family === selected) ?? null;

  return (
    <div className="simpop-overlay" onClick={onClose}>
      <div
        className="simpop"
        role="dialog"
        aria-modal="true"
        aria-label="Run a simulation"
        onClick={(event) => event.stopPropagation()}
      >
        <SimPopHeader onClose={onClose} />

        {scenarios.isError && (
          <p className="simpop-note" role="alert">
            Could not load scenarios.
          </p>
        )}

        <ScenarioList
          scenarios={shown}
          selected={selected}
          runFamilies={runFamilies}
          onSelect={setSelected}
        />

        <ScenarioPager current={current} pageCount={pageCount} onPage={setPage} />

        <div className="simpop-foot">
          {chosen !== null && <ExpectationNote kind={chosen.classification} />}
          {disabled && <p className="simpop-note">A simulation is already running.</p>}
          {start.isError && (
            <p className="simpop-note" role="alert">
              {start.error.message}
            </p>
          )}
          <button
            type="button"
            className="simpop-start"
            disabled={selected === null || disabled || start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Starting…' : 'Start simulation'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SimPopHeader({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <header className="simpop-head">
      <div>
        <h3>Run a simulation</h3>
        <p>
          Choose a scenario. Sentinel runs it through the same live detector — the outcome is not
          scripted.
        </p>
      </div>
      <button type="button" className="simpop-x" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </header>
  );
}

function ScenarioPager({
  current,
  pageCount,
  onPage,
}: {
  current: number;
  pageCount: number;
  onPage: (page: number) => void;
}): React.JSX.Element | null {
  if (pageCount <= 1) return null;
  return (
    <div className="simpop-pager">
      <button
        type="button"
        className="simpop-pager__btn"
        disabled={current === 0}
        onClick={() => onPage(current - 1)}
        aria-label="Previous scenarios"
      >
        ‹
      </button>
      <span className="simpop-pager__pos">
        {current + 1} / {pageCount}
      </span>
      <button
        type="button"
        className="simpop-pager__btn"
        disabled={current >= pageCount - 1}
        onClick={() => onPage(current + 1)}
        aria-label="More scenarios"
      >
        ›
      </button>
    </div>
  );
}

function ScenarioList({
  scenarios,
  selected,
  runFamilies,
  onSelect,
}: {
  scenarios: ScenarioSummary[];
  selected: string | null;
  runFamilies: Set<string>;
  onSelect: (family: string) => void;
}): React.JSX.Element {
  return (
    <ul className="simpop-list">
      {scenarios.map((scenario) => {
        const isRun = runFamilies.has(scenario.family);
        const isSelected = selected === scenario.family;
        return (
          <li key={scenario.family}>
            <button
              type="button"
              className={`simpop-item${isSelected ? ' is-selected' : ''}${isRun ? ' is-run' : ''}`}
              onClick={() => onSelect(scenario.family)}
              aria-pressed={isSelected}
            >
              <span className="simpop-item__top">
                <span className={`simpop-ico simpop-ico--${CAT_TONE[scenario.classification]}`}>
                  <CatIcon kind={scenario.classification} />
                </span>
                <span className={`simpop-cat simpop-cat--${CAT_TONE[scenario.classification]}`}>
                  {scenario.classification}
                </span>
                {isRun && (
                  <span
                    className="simpop-run"
                    title="Already run — re-running resets just this one"
                  >
                    ✓ Run
                  </span>
                )}
              </span>
              <span className="simpop-item__title">{scenario.title}</span>
              <span className="simpop-item__desc">{scenario.narrative}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ExpectationNote({ kind }: { kind: ScenarioSummary['classification'] }): React.JSX.Element {
  const expectation = EXPECTATION[kind];
  return (
    <div className={`simpop-expect simpop-expect--${expectation.tone}`}>
      <strong>{expectation.label}</strong>
      <span>{expectation.text}</span>
    </div>
  );
}
