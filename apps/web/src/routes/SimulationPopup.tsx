import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  scenarioListResponseSchema,
  simulationStartResponseSchema,
  type ScenarioSummary,
} from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';
import {
  WarningCircle,
  Gear,
  Check,
  Play,
  X,
  Storefront,
  Keyboard,
  PlugsConnected,
  ArrowsClockwise,
  TrendUp,
  ListNumbers,
  HourglassMedium,
  ShareNetwork,
  ShoppingBag,
  Browsers,
  Cards,
} from '@phosphor-icons/react';
import { fetchSimulationRuns as fetchRuns } from '../shared/fetchers.js';

async function fetchScenarios(): Promise<ScenarioSummary[]> {
  const response = await fetch('/api/replay', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return scenarioListResponseSchema.parse(await response.json()).scenarios;
}

async function startSimulation(family: string): Promise<void> {
  const response = await apiMutate('/api/simulation/start', { family });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(detail.message ?? `api returned ${response.status}`);
  }
  simulationStartResponseSchema.parse(await response.json());
}

const TONES: Record<ScenarioSummary['classification'], [string, string]> = {
  benign: ['oklch(0.955 0.026 162)', 'oklch(0.42 0.11 162)'],
  operational: ['oklch(0.962 0.028 62)', 'oklch(0.48 0.12 52)'],
  attack: ['oklch(0.958 0.026 22)', 'oklch(0.52 0.15 22)'],
};

/**
 * Ordered, and the order is load-bearing: 'carding' must be tested before 'card' or every carding
 * scenario would take the plain card icon. Kept as a table rather than a chain of ifs so adding a
 * scenario is one row instead of another branch.
 */
const SCENARIO_ICONS: readonly (readonly [
  readonly string[],
  React.ComponentType<{ size: number }>,
])[] = [
  [['ordinary', 'benign'], Storefront],
  [['mistype', 'keyboard'], Keyboard],
  [['outage', 'plug'], PlugsConnected],
  [['dunning'], ArrowsClockwise],
  [['sale'], TrendUp],
  [['enum'], ListNumbers],
  [['account'], HourglassMedium],
  [['proxy', 'network'], ShareNetwork],
  [['carding', 'shopping'], ShoppingBag],
  [['browser'], Browsers],
  [['card'], Cards],
];

/** Used only when the family name matches nothing above. */
const CLASSIFICATION_ICONS: Record<string, React.ComponentType<{ size: number }>> = {
  attack: WarningCircle,
  operational: Gear,
};

function getScenarioIcon(
  family: string,
  classification: ScenarioSummary['classification'],
): React.JSX.Element {
  const matched = SCENARIO_ICONS.find(([keywords]) => keywords.some((k) => family.includes(k)));
  const Icon = matched?.[1] ?? CLASSIFICATION_ICONS[classification] ?? Check;
  return <Icon size={16} />;
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

  const start = useMutation({
    mutationFn: () => startSimulation(selected!),
    onSuccess: () => onStarted(selected!),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = scenarios.data ?? [];
  const chosen = list.find((scenario) => scenario.family === selected) ?? null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        background: 'oklch(0.24 0.02 280 / 0.32)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Run a simulation"
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '920px',
          borderRadius: '16px',
          background: 'oklch(1 0 0)',
          boxShadow: '0 34px 80px -26px oklch(0.24 0.03 280 / 0.42)',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '14px',
            padding: '20px 24px 16px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: 700,
                letterSpacing: '-0.028em',
                color: 'oklch(0.21 0.015 280)',
              }}
            >
              Run a simulation
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12.5px',
                fontWeight: 500,
                color: 'oklch(0.55 0.015 280)',
              }}
            >
              Choose a scenario. Sentinel runs it through the same live detector — the outcome is
              not scripted.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 30px',
              width: '30px',
              height: '30px',
              border: 0,
              borderRadius: '8px',
              color: 'oklch(0.55 0.015 280)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 2-Column Scrollable Scenarios Grid */}
        <div
          className="om-scroll"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '8px',
            padding: '0 24px 4px',
            maxHeight: '54vh',
            overflowY: 'auto',
          }}
        >
          {list.map((scenario) => {
            const isRun = runFamilies.has(scenario.family);
            const isSelected = selected === scenario.family;
            const [bg, fg] = TONES[scenario.classification];

            return (
              <button
                key={scenario.family}
                type="button"
                onClick={() => setSelected(scenario.family)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '14px',
                  borderRadius: '11px',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color .14s ease, background .14s ease',
                  border: isSelected
                    ? '1.5px solid oklch(0.6 0.13 258)'
                    : '1.5px solid oklch(0.94 0.006 280)',
                  background: isSelected ? 'oklch(0.99 0.008 258)' : 'oklch(1 0 0)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 30px',
                    width: '30px',
                    height: '30px',
                    borderRadius: '9px',
                    background: bg,
                    color: fg,
                  }}
                >
                  {getScenarioIcon(scenario.family, scenario.classification)}
                </span>
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    minWidth: 0,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '13.5px',
                        fontWeight: 600,
                        letterSpacing: '-0.018em',
                        color: 'oklch(0.21 0.015 280)',
                      }}
                    >
                      {scenario.title}
                    </span>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '5px',
                        fontSize: '9px',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        whiteSpace: 'nowrap',
                        color: fg,
                        background: bg,
                        textTransform: 'uppercase',
                      }}
                    >
                      {scenario.classification}
                    </span>
                    {isRun && (
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'oklch(0.55 0.015 280)',
                        }}
                      >
                        ✓ RUN
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      lineHeight: 1.5,
                      color: 'oklch(0.56 0.015 280)',
                    }}
                  >
                    {scenario.narrative}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 24px 20px' }}
        >
          <span
            style={{
              minWidth: 0,
              fontSize: '12px',
              fontWeight: 500,
              color: 'oklch(0.58 0.015 280)',
            }}
          >
            {chosen ? `${chosen.title} selected` : 'Select a scenario to begin.'}
          </span>

          {start.isError && (
            <span style={{ fontSize: '12px', color: 'oklch(0.52 0.15 22)' }} role="alert">
              {start.error.message}
            </span>
          )}

          <button
            type="button"
            disabled={selected === null || disabled || start.isPending}
            onClick={() => start.mutate()}
            style={{
              flex: '0 0 auto',
              marginLeft: 'auto',
              padding: '10px 20px',
              border: 0,
              borderRadius: '9px',
              fontFamily: 'inherit',
              fontSize: '13px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: 'oklch(1 0 0)',
              background: selected ? 'oklch(0.55 0.15 258)' : 'oklch(0.86 0.008 280)',
              cursor: selected && !disabled && !start.isPending ? 'pointer' : 'not-allowed',
            }}
          >
            <Play size={14} style={{ verticalAlign: '-1px', marginRight: '7px' }} />
            {start.isPending ? 'Starting…' : 'Start simulation'}
          </button>
        </div>
      </div>
    </div>
  );
}
