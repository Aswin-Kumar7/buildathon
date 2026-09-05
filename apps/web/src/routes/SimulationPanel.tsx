import { useEffect, useRef, useState } from 'react';
import {
  FlowArrow,
  Eye,
  GitMerge,
  Crosshair,
  WarningOctagon,
  Check,
  Warning,
  CaretUp,
  CaretDown,
  X,
  PlayCircle,
} from '@phosphor-icons/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiMutate } from '../auth/api.js';
import { fetchSimulationStatus as fetchStatus } from '../shared/fetchers.js';

async function stopSimulation(): Promise<void> {
  const response = await apiMutate('/api/simulation/stop');
  if (!response.ok) throw new Error(`api returned ${response.status}`);
}

const TONES: Record<string, [string, string]> = {
  benign: ['oklch(0.955 0.026 162)', 'oklch(0.42 0.11 162)'],
  operational: ['oklch(0.962 0.028 62)', 'oklch(0.48 0.12 52)'],
  attack: ['oklch(0.958 0.026 22)', 'oklch(0.52 0.15 22)'],
};

const PHASES = [
  ['Generating', FlowArrow],
  ['Monitoring', Eye],
  ['Correlating', GitMerge],
  ['Detecting', Crosshair],
  ['Incident', WarningOctagon],
] as const;

export function SimulationPanel({
  onClose,
  onTick,
}: {
  onClose: () => void;
  onTick: () => void;
}): React.JSX.Element | null {
  const status = useQuery({
    queryKey: ['simulation-status'],
    queryFn: fetchStatus,
    refetchInterval: 2500,
  });

  const stop = useMutation({
    mutationFn: stopSimulation,
    onSuccess: () => void status.refetch(),
  });

  const [userToggledFeed, setUserToggledFeed] = useState<boolean | null>(null);

  const s = status.data;
  const isRunning = s?.running ?? false;
  const feedOpen =
    userToggledFeed !== null ? userToggledFeed : isRunning || (s?.recentActivity.length ?? 0) > 0;

  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  useEffect(() => {
    onTickRef.current();
  }, [s?.emitted, s?.incidentsDetected]);

  if (!s || (!s.running && s.emitted === 0 && s.scenario === null)) return null;

  const toneKey = s.scenario?.classification ?? 'benign';
  const [bg, fg] = (TONES[toneKey] ?? TONES.benign) as [string, string];
  const isDone = !s.running;

  // Phase computation
  const curPhase = isDone
    ? 4
    : s.incidentsDetected > 0
      ? 4
      : s.attemptsCorrelated > 0
        ? 3
        : s.emitted > 0
          ? 1
          : 0;

  const phaseNote = isDone
    ? s.incidentsDetected > 0
      ? `Incident opened — ${s.attemptsCorrelated || s.emitted} attempts correlated to abuse pattern.`
      : `Correlating and evaluating — ${s.emitted} attempts grouped, no incident raised.`
    : [
        'Generating traffic against the live detector.',
        'Monitoring attempts as they arrive.',
        'Correlating attempts by device, card and network.',
        'Evaluating correlated groups against the policy.',
        'Incident evaluation active.',
      ][curPhase] || '';

  const verdictTitle = isDone
    ? s.incidentsDetected > 0
      ? 'Incident raised — abuse pattern detected'
      : 'No incident opened — and that is the right call'
    : '';

  const verdictText = isDone
    ? s.incidentsDetected > 0
      ? `${s.emitted} attempts, correlated device fingerprint, matching card-testing pattern. Incident opened.`
      : `This was ordinary, legitimate traffic. Sentinel opens an incident only when payments match an abuse pattern. Real customers paying never qualify.`
    : '';

  return (
    <aside
      style={{
        flex: '1 1 300px',
        maxWidth: '326px',
        minWidth: '280px',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '14px 16px',
          borderBottom: '1px solid oklch(0.95 0.006 280)',
          background: 'oklch(0.99 0.002 270)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 24px',
              width: '24px',
              height: '24px',
              borderRadius: '7px',
              background: bg,
              color: fg,
            }}
          >
            <PlayCircle size={14} />
          </span>
          <span
            style={{
              fontSize: '13.5px',
              fontWeight: 600,
              letterSpacing: '-0.022em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'oklch(0.21 0.015 280)',
            }}
          >
            {s.scenario?.title ?? 'Simulation'}
          </span>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--s-radius-pill)',
              fontSize: '10.5px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: 'oklch(0.44 0.015 280)',
              background: 'oklch(0.958 0.006 280)',
            }}
          >
            SIMULATED
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: 'var(--s-radius-pill)',
              fontSize: '10.5px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: isDone ? 'oklch(0.42 0.015 280)' : 'oklch(0.46 0.12 258)',
              background: isDone ? 'oklch(0.955 0.006 280)' : 'oklch(0.962 0.024 258)',
            }}
          >
            {isDone ? 'Simulation finished' : 'Running'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 26px',
              width: '26px',
              height: '26px',
              border: 0,
              borderRadius: '7px',
              color: 'oklch(0.58 0.015 280)',
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: 1.55,
            color: 'oklch(0.55 0.015 280)',
          }}
        >
          {s.scenario?.description ?? 'Streamed payment attempts running through Sentinel.'}
        </p>
      </div>

      {/* 3 Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          borderTop: '1px solid oklch(0.958 0.006 280)',
          borderBottom: '1px solid oklch(0.958 0.006 280)',
        }}
      >
        {(
          [
            ['Payments generated', String(s.emitted), false],
            ['Incidents detected', String(s.incidentsDetected), s.incidentsDetected > 0],
            ['Attempts correlated', String(s.attemptsCorrelated), false],
          ] as [string, string, boolean][]
        ).map(([label, val, hot], idx) => (
          <div
            key={label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '7px',
              padding: '12px 14px',
              borderLeft: idx > 0 ? '1px solid oklch(0.958 0.006 280)' : 'none',
            }}
          >
            <span
              style={{
                fontSize: '9.5px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                lineHeight: 1.3,
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontSize: '22px',
                fontWeight: 700,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                color: hot
                  ? 'oklch(0.5 0.15 22)'
                  : val === '0'
                    ? 'oklch(0.74 0.015 280)'
                    : 'oklch(0.21 0.015 280)',
              }}
            >
              {val}
            </span>
          </div>
        ))}
      </div>

      {/* Current Phase Stepper */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '14px 16px',
          borderBottom: '1px solid oklch(0.958 0.006 280)',
        }}
      >
        <span
          style={{
            fontSize: '10.5px',
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'oklch(0.52 0.015 280)',
          }}
        >
          Current phase
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          {PHASES.map(([label, IconComp], i) => {
            const isIncidentStep = i === 4;
            const reached = i < curPhase || (isDone && i <= curPhase);
            const active = i === curPhase && !reached;
            const lit = reached || active;

            const ACC = isIncidentStep ? 'oklch(0.64 0.15 22)' : 'oklch(0.62 0.13 258)';
            const SOFT = isIncidentStep ? 'oklch(0.952 0.03 22)' : 'oklch(0.955 0.028 258)';
            const INK = isIncidentStep ? 'oklch(0.52 0.15 22)' : 'oklch(0.46 0.13 258)';

            return (
              <div
                key={label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '7px',
                  flex: '1 1 0',
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <span
                    style={{
                      flex: '1 1 0',
                      height: '2px',
                      background:
                        i === 0
                          ? 'transparent'
                          : lit
                            ? 'oklch(0.82 0.07 258)'
                            : 'oklch(0.93 0.006 280)',
                    }}
                  />
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: '0 0 26px',
                      width: '26px',
                      height: '26px',
                      borderRadius: '99px',
                      transition: 'background .25s ease, border-color .25s ease',
                      background: reached ? SOFT : 'oklch(1 0 0)',
                      border: reached
                        ? `1.5px solid ${ACC}`
                        : active
                          ? `2px solid ${ACC}`
                          : '1.5px solid oklch(0.93 0.006 280)',
                    }}
                  >
                    {reached ? (
                      <Check size={12} style={{ color: INK }} />
                    ) : (
                      <IconComp size={12} style={{ color: active ? INK : 'oklch(0.8 0.01 280)' }} />
                    )}
                  </span>
                  <span
                    style={{
                      flex: '1 1 0',
                      height: '2px',
                      background:
                        i === PHASES.length - 1
                          ? 'transparent'
                          : reached
                            ? 'oklch(0.82 0.07 258)'
                            : 'oklch(0.93 0.006 280)',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: '9.5px',
                    fontWeight: lit ? 700 : 500,
                    letterSpacing: '0.02em',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                    color: lit
                      ? isIncidentStep
                        ? 'oklch(0.5 0.14 22)'
                        : 'oklch(0.42 0.11 258)'
                      : 'oklch(0.7 0.015 280)',
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: '11.5px',
            fontWeight: 500,
            lineHeight: 1.5,
            color: 'oklch(0.55 0.015 280)',
          }}
        >
          {phaseNote}
        </p>
      </div>

      {/* Incidents Detected List */}
      {s.detected.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px 16px',
            borderBottom: '1px solid oklch(0.958 0.006 280)',
          }}
        >
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'oklch(0.52 0.015 280)',
            }}
          >
            Incidents detected
          </span>
          {s.detected.map((inc) => (
            <div
              key={inc.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px 13px',
                borderRadius: '11px',
                background: 'oklch(0.982 0.014 22)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: '0 0 20px',
                  width: '20px',
                  height: '20px',
                  marginTop: '1px',
                  borderRadius: '99px',
                  background: 'oklch(0.58 0.17 22)',
                  color: 'oklch(1 0 0)',
                }}
              >
                <Warning size={12} />
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'oklch(0.22 0.015 280)',
                  }}
                >
                  {inc.title}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Detection Outcome Verdict */}
      {isDone && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px 16px',
            borderBottom: '1px solid oklch(0.958 0.006 280)',
          }}
        >
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'oklch(0.52 0.015 280)',
            }}
          >
            Detection outcome
          </span>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              padding: '12px 13px',
              borderRadius: '11px',
              background:
                s.incidentsDetected > 0 ? 'oklch(0.982 0.014 22)' : 'oklch(0.98 0.014 162)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: '0 0 20px',
                width: '20px',
                height: '20px',
                marginTop: '1px',
                borderRadius: '99px',
                background:
                  s.incidentsDetected > 0 ? 'oklch(0.58 0.17 22)' : 'oklch(0.55 0.13 162)',
                color: 'oklch(1 0 0)',
              }}
            >
              {s.incidentsDetected > 0 ? <Warning size={12} /> : <Check size={12} />}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
              <span
                style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  letterSpacing: '-0.012em',
                  lineHeight: 1.35,
                  color: 'oklch(0.22 0.015 280)',
                }}
              >
                {verdictTitle}
              </span>
              <span
                style={{
                  fontSize: '11.5px',
                  fontWeight: 500,
                  lineHeight: 1.55,
                  color: 'oklch(0.45 0.015 280)',
                }}
              >
                {verdictText}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Stood Down Incidents */}
      {s.stoodDown && s.stoodDown.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px 16px',
            borderBottom: '1px solid oklch(0.958 0.006 280)',
          }}
        >
          <span
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'oklch(0.52 0.015 280)',
            }}
          >
            Opened, then stood down
          </span>
          {s.stoodDown.map((sd) => (
            <div
              key={sd.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px 13px',
                borderRadius: '11px',
                background: 'oklch(0.98 0.014 162)',
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                <span
                  style={{
                    fontSize: '12.5px',
                    fontWeight: 600,
                    color: 'oklch(0.22 0.015 280)',
                  }}
                >
                  {sd.title}
                </span>
                <span
                  style={{
                    fontSize: '11.5px',
                    fontWeight: 500,
                    color: 'oklch(0.45 0.015 280)',
                  }}
                >
                  Re-classified as {sd.resolvedAs ?? 'retry storm'}
                </span>
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  padding: '3px 10px',
                  borderRadius: 'var(--s-radius-pill)',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  color: 'oklch(0.4 0.11 162)',
                  background: 'oklch(0.955 0.03 162)',
                }}
              >
                stood down
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Expandable Live Activity Feed */}
      <button
        type="button"
        onClick={() => setUserToggledFeed(!feedOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          padding: '13px 16px',
          border: 0,
          borderTop: '1px solid oklch(0.958 0.006 280)',
          fontFamily: 'inherit',
          background: 'oklch(1 0 0)',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            flex: '0 0 6px',
            width: '6px',
            height: '6px',
            borderRadius: '99px',
            background: 'oklch(0.58 0.16 22)',
          }}
        />
        <span
          style={{
            fontSize: '12.5px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'oklch(0.26 0.015 280)',
          }}
        >
          Live activity
        </span>
        <span
          style={{
            padding: '2px 7px',
            borderRadius: 'var(--s-radius-pill)',
            fontSize: '10.5px',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: 'oklch(0.5 0.015 280)',
            background: 'oklch(0.958 0.006 280)',
          }}
        >
          {s.recentActivity.length}
        </span>
        {feedOpen ? (
          <CaretUp size={13} style={{ marginLeft: 'auto', color: 'oklch(0.62 0.015 280)' }} />
        ) : (
          <CaretDown size={13} style={{ marginLeft: 'auto', color: 'oklch(0.62 0.015 280)' }} />
        )}
      </button>

      {feedOpen && (
        <div
          className="om-scroll"
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '0 16px 12px',
            maxHeight: '208px',
            overflowY: 'auto',
          }}
        >
          {s.recentActivity.map((ev, idx) => (
            <div
              key={`${ev.at}-${idx}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '9px 0',
                borderTop: idx > 0 ? '1px solid oklch(0.968 0.006 280)' : 'none',
              }}
            >
              <span
                style={{
                  flex: '0 0 68px',
                  fontSize: '11px',
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'oklch(0.6 0.015 280)',
                }}
              >
                {new Date(ev.at).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: true,
                })}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'oklch(0.24 0.015 280)' }}>
                  {ev.kind === 'incident' ? 'Incident detected' : 'Payment attempt'}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'oklch(0.58 0.015 280)',
                  }}
                >
                  {ev.kind === 'incident'
                    ? ev.title
                    : `${ev.amountPaise ? `₹${(ev.amountPaise / 100).toFixed(2)}` : '—'} · ${ev.status ?? 'processing'}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stop button when running */}
      {s.running && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid oklch(0.958 0.006 280)' }}>
          <button
            type="button"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            style={{
              width: '100%',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid oklch(0.85 0.01 280)',
              background: 'oklch(0.98 0.003 270)',
              color: 'oklch(0.3 0.015 280)',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {stop.isPending ? 'Stopping…' : 'Stop simulation'}
          </button>
        </div>
      )}
    </aside>
  );
}
