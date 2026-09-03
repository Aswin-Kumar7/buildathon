import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  incidentListResponseSchema,
  simulationStatusSchema,
  type IncidentListResponse,
  type IncidentSummary,
  type SimulationStatus,
} from '@sentinel/contracts';
import {
  IncidentSummaryCards,
  type Bucket,
  type SummaryKey,
  bucketOf,
} from './IncidentsSummary.js';
import { IncidentsTable } from './IncidentsTable.js';
import { SimulationPopup } from './SimulationPopup.js';
import { SimulationPanel } from './SimulationPanel.js';
import { RunHistory } from './RunHistory.js';
import { useSimDock } from '../shell/SimulationDock.js';
import './IncidentsPage.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import {
  PlayCircle,
  DownloadSimple,
  CalendarBlank,
  Gauge,
  Funnel,
  FlowArrow,
  MagnifyingGlass,
} from '@phosphor-icons/react';

type Source = 'all' | IncidentSummary['source'];
type StatusTab = 'all' | 'active' | 'under_review' | 'resolved' | 'expired' | 'history';
type Sort = 'latest' | 'oldest' | 'risk';

const STATUS_TABS: { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'Status: all' },
  { id: 'active', label: 'Active' },
  { id: 'under_review', label: 'Under review' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'expired', label: 'Expired' },
];

const RISK_LEVELS: { id: Bucket | 'all'; label: string }[] = [
  { id: 'all', label: 'Risk: all' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const SOURCES: { id: Source; label: string }[] = [
  { id: 'all', label: 'Source: all' },
  { id: 'razorpay', label: 'Live' },
  { id: 'replay', label: 'Simulation' },
];

async function fetchIncidents(source: Source): Promise<IncidentListResponse> {
  const query = source === 'all' ? '' : `?source=${source}`;
  const response = await fetch(`/api/incidents${query}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return incidentListResponseSchema.parse(await response.json());
}

async function fetchSimStatus(): Promise<SimulationStatus> {
  const response = await fetch('/api/simulation/status', { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return simulationStatusSchema.parse(await response.json());
}

function inTab(incident: IncidentSummary, tab: StatusTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'active') return incident.status === 'open' || incident.status === 'contained';
  if (tab === 'history') return false;
  return incident.status === tab;
}

export interface Filters {
  source: Source;
  tab: StatusTab;
  risk: Bucket | 'all';
  search: string;
  sort: Sort;
}

const DEFAULTS: Filters = { source: 'all', tab: 'all', risk: 'all', search: '', sort: 'latest' };

function useIncidentsData(source: Source): {
  sim: UseQueryResult<SimulationStatus>;
  simRunning: boolean;
  incidents: UseQueryResult<IncidentListResponse>;
  all: IncidentSummary[];
} {
  const sim = useQuery({
    queryKey: ['simulation-status'],
    queryFn: fetchSimStatus,
    refetchInterval: 5000,
  });
  const simRunning = sim.data?.running ?? false;

  const incidents = useQuery({
    queryKey: ['incidents', source],
    queryFn: () => fetchIncidents(source),
    refetchInterval: simRunning ? 4000 : 20_000,
  });
  const all = useMemo(() => incidents.data?.incidents ?? [], [incidents.data]);
  return { sim, simRunning, incidents, all };
}

export function IncidentsPage(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [page, setPage] = useState(1);
  const [popupOpen, setPopupOpen] = useState(false);
  const dock = useSimDock();

  const { sim, simRunning, incidents, all } = useIncidentsData(f.source);

  const set = (patch: Partial<Filters>): void => {
    setF((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };
  const rows = sortAndFilter(all, f);

  const summaryActive: SummaryKey | null =
    f.tab === 'resolved' ? 'resolved' : f.risk === 'all' ? null : f.risk;

  const pickSummary = (key: SummaryKey): void => {
    if (key === 'resolved') {
      set({ tab: f.tab === 'resolved' ? 'all' : 'resolved', risk: 'all' });
    } else {
      const alreadyActive = f.risk === key && f.tab !== 'resolved';
      set({ risk: alreadyActive ? 'all' : key, tab: 'all' });
    }
  };

  const handleExport = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(rows, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `incidents-${new Date().toISOString().split('T')[0]}.json`,
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="incp-page">
      <Header
        count={all.length}
        popupOpen={popupOpen}
        togglePopup={() => setPopupOpen((v) => !v)}
        closePopup={() => setPopupOpen(false)}
        simRunning={simRunning}
        minimized={dock.view === 'minimized'}
        simStatus={sim.data}
        onChipOpen={dock.open}
        onChipDismiss={dock.dismiss}
        onExport={handleExport}
        onStarted={() => {
          dock.open();
          setPopupOpen(false);
          set({ source: 'all' });
          void client.invalidateQueries({ queryKey: ['incidents'] });
          void client.invalidateQueries({ queryKey: ['simulation-status'] });
        }}
      />

      <IncidentSummaryCards incidents={all} active={summaryActive} onPick={pickSummary} />

      {f.tab === 'history' ? (
        <RunHistory />
      ) : (
        <IncidentsTable
          incidents={rows}
          loading={incidents.isPending}
          error={incidents.isError ? incidents.error.message : null}
          page={page}
          onPage={setPage}
          onOpen={(id) => void navigate({ to: '/console/incidents/$id', params: { id } })}
          filterProps={{
            filters: f,
            onChange: set,
            onClear: () => set(DEFAULTS),
          }}
        />
      )}

      {dock.view === 'open' && (
        <SimulationPanel
          onClose={dock.minimize}
          onTick={() => void client.invalidateQueries({ queryKey: ['incidents'] })}
        />
      )}
    </div>
  );
}

function sortAndFilter(all: IncidentSummary[], f: Filters): IncidentSummary[] {
  const term = f.search.trim().toLowerCase();
  const filtered = all
    .filter((incident) => inTab(incident, f.tab))
    .filter((incident) => f.risk === 'all' || bucketOf(incident) === f.risk)
    .filter(
      (incident) =>
        term === '' ||
        incident.title.toLowerCase().includes(term) ||
        incident.id.toLowerCase().includes(term) ||
        incident.entityKey.toLowerCase().includes(term),
    );
  return filtered.sort((a, b) =>
    f.sort === 'risk'
      ? b.score - a.score
      : f.sort === 'oldest'
        ? a.detectedAt - b.detectedAt
        : b.detectedAt - a.detectedAt,
  );
}

function Header({
  count,
  popupOpen,
  togglePopup,
  closePopup,
  simRunning,
  onStarted,
  minimized,
  simStatus,
  onChipOpen,
  onChipDismiss,
  onExport,
}: {
  count: number;
  popupOpen: boolean;
  togglePopup: () => void;
  closePopup: () => void;
  simRunning: boolean;
  onStarted: (family: string) => void;
  minimized: boolean;
  simStatus: SimulationStatus | undefined;
  onChipOpen: () => void;
  onChipDismiss: () => void;
  onExport: () => void;
}): React.JSX.Element {
  return (
    <header className="incp-head">
      <div className="incp-head__left">
        <h1>Incidents</h1>
        <p>
          {count} {count === 1 ? 'incident' : 'incidents'} · attempts grouped by entity and risk
          pattern
        </p>
      </div>
      <div className="incp-head__actions">
        {minimized && <SimChip status={simStatus} onOpen={onChipOpen} onDismiss={onChipDismiss} />}
        <button type="button" className="incp-btn-export" onClick={onExport}>
          <DownloadSimple size={14} /> Export
        </button>
        <button type="button" className="incp-btn-run" onClick={togglePopup}>
          <PlayCircle size={15} /> Run simulation
        </button>
        {popupOpen && (
          <SimulationPopup disabled={simRunning} onClose={closePopup} onStarted={onStarted} />
        )}
      </div>
    </header>
  );
}

function RingProgress({ pct, active }: { pct: number; active: boolean }): React.JSX.Element {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, pct / 100)));
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="incp-ring">
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="var(--s-line-2, #e4e7ec)"
        strokeWidth="2.5"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke={active ? '#1E6FD9' : '#12854a'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}

function SimChip({
  status,
  onOpen,
  onDismiss,
}: {
  status: SimulationStatus | undefined;
  onOpen: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const running = status?.running ?? false;
  const emitted = status?.emitted ?? 0;
  const total = status?.total ?? 0;
  const pct = total === 0 ? (running ? 0 : 100) : Math.round((emitted / total) * 100);
  return (
    <span className="incp-simchip">
      <button type="button" className="incp-simchip__main" onClick={onOpen} title="Show simulation">
        <RingProgress pct={pct} active={running} />
        <span className="incp-simchip__text">
          {running ? 'Simulation running' : 'Simulation finished'}
          {total > 0 && (
            <em>
              {emitted}/{total}
            </em>
          )}
        </span>
      </button>
      <button
        type="button"
        className="incp-simchip__x"
        onClick={onDismiss}
        aria-label="Dismiss simulation"
      >
        ✕
      </button>
    </span>
  );
}

export interface FilterRowProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}

export function FilterRow({ filters, onChange }: FilterRowProps): React.JSX.Element {
  return (
    <div className="inct-toolbar">
      <div className="inct-toolbar-filters">
        <button type="button" className="ap-pill-btn" aria-label="All dates">
          <CalendarBlank size={14} />
          <span>All dates</span>
          <span className="ap-pill-chevron">▾</span>
        </button>

        <CustomSelectPill
          value={filters.risk}
          options={RISK_LEVELS.map((r) => ({
            value: r.id,
            label: r.label,
          }))}
          onChange={(val) => onChange({ risk: val as Bucket | 'all' })}
          ariaLabel="Risk level"
          icon={<Gauge size={14} />}
        />

        <CustomSelectPill
          value={filters.tab}
          options={STATUS_TABS.map((t) => ({
            value: t.id,
            label: t.label,
          }))}
          onChange={(val) => onChange({ tab: val as StatusTab })}
          ariaLabel="Status"
          icon={<Funnel size={14} />}
        />

        <CustomSelectPill
          value={filters.source}
          options={SOURCES.map((s) => ({
            value: s.id,
            label: s.label,
          }))}
          onChange={(val) => onChange({ source: val as Source })}
          ariaLabel="Source"
          icon={<FlowArrow size={14} />}
        />
      </div>

      <div className="inct-toolbar-search">
        <MagnifyingGlass size={15} />
        <input
          type="search"
          placeholder="Find incident…"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          aria-label="Search incidents"
        />
      </div>
    </div>
  );
}
