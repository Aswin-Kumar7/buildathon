import { useEffect, useRef } from 'react';
import {
  Lightning,
  Pulse as PulseIcon,
  GitBranch,
  MagnifyingGlass,
  WarningCircle,
  Check,
  PlayCircle,
  Shield,
} from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  simulationStatusSchema,
  type SimulationActivity,
  type SimulationDetected,
  type SimulationStatus,
} from '@sentinel/contracts';
import { apiMutate } from '../auth/api.js';

async function fetchStatus(): Promise<SimulationStatus> {
  const response = await fetch('/api/simulation/status', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return simulationStatusSchema.parse(await response.json());
}
async function stopSimulation(): Promise<void> {
  const response = await apiMutate('/api/simulation/stop');
  if (!response.ok) throw new Error(`api returned ${response.status}`);
}

const rupees = (paise: number | null): string =>
  paise === null ? '—' : `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

const STEPS: {
  key: string;
  label: string;
  icon: React.ReactNode;
  reached: (s: SimulationStatus) => boolean;
}[] = [
  { key: 'generating', label: 'Generating', icon: <Lightning />, reached: (s) => s.emitted > 0 },
  { key: 'monitoring', label: 'Monitoring', icon: <PulseIcon />, reached: (s) => s.emitted > 0 },
  {
    key: 'correlating',
    label: 'Correlating',
    icon: <GitBranch />,
    reached: (s) => s.attemptsCorrelated > 0,
  },
  {
    key: 'detecting',
    label: 'Detecting',
    icon: <MagnifyingGlass />,
    reached: (s) => s.evaluations > 0,
  },
  {
    key: 'incident',
    label: 'Incident',
    icon: <WarningCircle />,
    reached: (s) => s.incidentsDetected > 0,
  },
];

function phaseLine(s: SimulationStatus): string {
  if (s.incidentsDetected > 0) return 'Incident opened — Sentinel detected the pattern.';
  if (s.phase === 'generating') return 'Streaming payment attempts through the live pipeline…';
  if (s.phase === 'analyzing')
    return `Correlating and evaluating — ${s.attemptsCorrelated} attempts grouped, no incident yet.`;
  return 'Idle.';
}

export function SimulationPanel({
  onClose,
  onTick,
}: {
  onClose: () => void;
  onTick: () => void;
}): React.JSX.Element {
  const status = useQuery({
    queryKey: ['simulation-status'],
    queryFn: fetchStatus,
    refetchInterval: 2500,
  });
  const stop = useMutation({ mutationFn: stopSimulation, onSuccess: () => void status.refetch() });

  const s = status.data;
  // Refresh the incidents table only when real run progress changes — same backend source of truth,
  // via a ref so a new onTick identity each render cannot spin a refetch loop.
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  useEffect(() => {
    onTickRef.current();
  }, [s?.emitted, s?.incidentsDetected]);

  return (
    <aside className="simpanel">
      <header className="simpanel-head">
        <span className="simpanel-title">
          <PlayCircle /> Simulation
        </span>
        <button type="button" className="simpanel-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {s === undefined ? (
        <p className="simpanel-note">Loading run state…</p>
      ) : (
        <>
          {(s.running || s.emitted > 0 || s.scenario !== null) && (
            <>
              <p className={`simpanel-status simpanel-status--${s.running ? 'on' : 'off'}`}>
                <i aria-hidden="true" /> {s.running ? 'Simulation running' : 'Simulation finished'}
              </p>

              {s.scenario !== null && (
                <div className="simpanel-scenario">
                  <Shield />
                  <strong>{s.scenario.title}</strong>
                  <span className="simpanel-tag">SIMULATED</span>
                </div>
              )}
              {s.scenario !== null && <p className="simpanel-desc">{s.scenario.description}</p>}

              <Metrics status={s} />

              <div className="simpanel-block">
                <h4>Current phase</h4>
                <Pipeline status={s} />
                <p className="simpanel-phaseline">{phaseLine(s)}</p>
              </div>

              <Detected status={s} />

              <StoodDown status={s} />

              <div className="simpanel-block">
                <h4>Live activity</h4>
                <Pulse items={s.recentActivity} />
              </div>

              {s.running && (
                <button
                  type="button"
                  className="simpanel-stop"
                  onClick={() => stop.mutate()}
                  disabled={stop.isPending}
                >
                  {stop.isPending ? 'Stopping…' : 'Stop simulation'}
                </button>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}

function Metrics({ status }: { status: SimulationStatus }): React.JSX.Element {
  const cells: [string, number][] = [
    ['Payments generated', status.emitted],
    ['Incidents detected', status.incidentsDetected],
    ['Attempts correlated', status.attemptsCorrelated],
  ];
  return (
    <div className="simpanel-metrics">
      {cells.map(([label, value]) => (
        <div key={label}>
          <span className="simpanel-metric__label">{label}</span>
          <strong className="simpanel-metric__value">{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Pipeline({ status }: { status: SimulationStatus }): React.JSX.Element {
  const reached = STEPS.map((step) => step.reached(status));
  const activeIndex = reached.lastIndexOf(true);
  return (
    <div className="simpanel-pipeline">
      <ol className="simpanel-pipe">
        {STEPS.map((step, index) => {
          const isReached = reached[index];
          const isDone = isReached && (index < activeIndex || !status.running);
          const isActive = index === activeIndex && status.running;
          const isNextReached = index < STEPS.length - 1 && reached[index + 1];
          const state = !isReached ? 'pending' : isActive ? 'active' : 'done';
          return (
            <li key={step.key} className={`simpanel-step simpanel-step--${state}`}>
              <div className="simpanel-step__node-wrap">
                <span className="simpanel-node" aria-hidden="true">
                  {isDone ? <Check /> : step.icon}
                </span>
                {index < STEPS.length - 1 && (
                  <span
                    className={`simpanel-rail${isNextReached ? ' is-filled' : isActive ? ' is-animating' : ''}`}
                  />
                )}
              </div>
              <span className="simpanel-step__label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Why a finished run raised nothing — so a correct "no incident" is never read as a broken run. */
function noIncidentCopy(status: SimulationStatus): {
  headline: string;
  body: string;
  correct: boolean;
} {
  const kind = status.scenario?.classification ?? null;
  if (kind === 'benign') {
    return {
      correct: true,
      headline: 'No incident — and that is the right call',
      body: 'This was ordinary, legitimate traffic. Sentinel opens an incident only when payments match an abuse pattern — rapid card-testing, enumeration across many cards. Real customers paying never qualify, so nothing was raised.',
    };
  }
  if (kind === 'operational') {
    return {
      correct: true,
      headline: 'No incident — and that is the right call',
      body: 'A gateway wobble and biller retries are operational noise, not abuse. Sentinel deliberately holds fire on these so a real attack is not buried under false alarms.',
    };
  }
  return {
    correct: false,
    headline: 'No incident opened',
    body: 'The streamed attempts did not match an abuse pattern this run. Ordinary orders, retries after a decline and gateway wobbles are expected and stay off the incident list.',
  };
}

function Detected({ status }: { status: SimulationStatus }): React.JSX.Element | null {
  if (status.detected.length > 0) {
    return (
      <div className="simpanel-block">
        <h4>Detected by Sentinel</h4>
        {status.detected.map((incident) => (
          <DetectedRow key={incident.id} incident={incident} />
        ))}
      </div>
    );
  }
  if (!status.running && status.emitted > 0) {
    const copy = noIncidentCopy(status);
    return (
      <div className="simpanel-block">
        <h4>Detection outcome</h4>
        <div className={`simpanel-clear${copy.correct ? ' simpanel-clear--ok' : ''}`}>
          <span className="simpanel-clear__ico" aria-hidden="true">
            {copy.correct ? '✓' : 'ⓘ'}
          </span>
          <span className="simpanel-clear__text">
            <strong>{copy.headline}</strong>
            <span>{copy.body}</span>
          </span>
        </div>
      </div>
    );
  }
  return null;
}

/**
 * Incidents the detector opened on a burst and then stood down. Shown apart from detections — this
 * is the judgment on display (a dunning storm that briefly looked like testing, re-classified and
 * resolved), never a detection, so it is never counted as one.
 */
function StoodDown({ status }: { status: SimulationStatus }): React.JSX.Element | null {
  if (status.stoodDown.length === 0) return null;
  return (
    <div className="simpanel-block">
      <h4>Opened, then stood down</h4>
      <p className="simpanel-runsnote">
        Sentinel opened these on a burst, then re-evaluated and resolved them as legitimate — no
        action taken. This is the restraint that keeps a real attack from being buried in false
        alarms.
      </p>
      {status.stoodDown.map((incident) => (
        <div key={incident.id} className="simpanel-stood">
          <span className="simpanel-stood__ico" aria-hidden="true">
            <Shield />
          </span>
          <span className="simpanel-detected__text">
            <strong>{incident.title}</strong>
            <span>
              Re-classified as {incident.resolvedAs} · {incident.entityKind}
            </span>
          </span>
          <span className="simpanel-stood__pill">stood down</span>
        </div>
      ))}
    </div>
  );
}

function DetectedRow({ incident }: { incident: SimulationDetected }): React.JSX.Element {
  const bucket =
    incident.severity === 'high' && incident.score >= 0.9 ? 'critical' : incident.severity;
  return (
    <Link to="/console/incidents/$id" params={{ id: incident.id }} className="simpanel-detected">
      <span className={`simpanel-detected__ico simpanel-detected__ico--${bucket}`}>
        <Shield />
      </span>
      <span className="simpanel-detected__text">
        <strong>{incident.title}</strong>
        <span>
          {Math.round(incident.score * 100)}/100 · {incident.entityKind}
        </span>
      </span>
      <span className={`simpanel-detected__pill simpanel-detected__pill--${bucket}`}>{bucket}</span>
    </Link>
  );
}

function Pulse({ items }: { items: SimulationActivity[] }): React.JSX.Element {
  if (items.length === 0) return <p className="simpanel-none">No events yet.</p>;
  return (
    <ol className="simpanel-activity">
      {items.map((item, index) => (
        <li key={`${item.at}-${index}`} className="simpanel-act">
          <span className="simpanel-act__time">{clock(item.at)}</span>
          {item.kind === 'incident' ? (
            <span className="simpanel-act__body">
              <strong className="simpanel-act__crit">Incident detected</strong>
              <span>{item.title}</span>
            </span>
          ) : (
            <span className="simpanel-act__body">
              <strong>Payment attempt</strong>
              <span>
                {rupees(item.amountPaise)} · {item.status ?? 'processing'}
                {item.paymentId !== null && ` · ${item.paymentId.slice(-8)}`}
              </span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
