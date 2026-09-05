import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  incidentListResponseSchema,
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
  Gauge,
  Funnel,
  FlowArrow,
  MagnifyingGlass,
  CheckCircle,
  CircleNotch,
  X,
} from '@phosphor-icons/react';
import { fetchSimulationStatus as fetchSimStatus } from '../shared/fetchers.js';

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

      <div
        style={{
          display: 'flex',
          flexWrap: 'nowrap',
          gap: '12px',
          alignItems: 'flex-start',
          width: '100%',
        }}
      >
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
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
        </div>

        {(dock.view === 'open' || simRunning) && (
          <SimulationPanel
            onClose={dock.minimize}
            onTick={() => void client.invalidateQueries({ queryKey: ['incidents'] })}
          />
        )}
      </div>
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
        {simStatus && (simStatus.running || simStatus.emitted > 0) && (
          <SimChip status={simStatus} onOpen={onChipOpen} onDismiss={onChipDismiss} />
        )}
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

function SimChip({
  status,
  onOpen,
  onDismiss,
}: {
  status: SimulationStatus | undefined;
  onOpen: () => void;
  onDismiss: () => void;
}): React.JSX.Element | null {
  if (!status || (!status.running && status.emitted === 0 && status.scenario === null)) {
    return null;
  }

  const running = status.running;
  const emitted = status.emitted ?? 0;
  const total = status.total || emitted || 0;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        padding: '6px 14px',
        borderRadius: 'var(--s-radius-pill)',
        fontSize: '13px',
        fontWeight: 600,
        fontFamily: 'inherit',
        background: running ? '#E8F0FE' : '#E6F4EA',
        border: `1px solid ${running ? '#D2E3FC' : '#CEEAD6'}`,
        color: running ? '#1A73E8' : '#0D652D',
        transition: 'all 0.15s ease',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        title="Show simulation details"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          border: 0,
          background: 'transparent',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {running ? (
          <CircleNotch size={16} className="csp-spinner" />
        ) : (
          <CheckCircle size={16} weight="bold" />
        )}
        <span>{running ? 'Simulation running' : 'Simulation finished'}</span>
        {total > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 9px',
              borderRadius: 'var(--s-radius-pill)',
              background: '#FFFFFF',
              color: running ? '#1A73E8' : '#0D652D',
              fontSize: '12.5px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {emitted}/{total}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss simulation banner"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 0,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          padding: 0,
          marginLeft: '2px',
        }}
      >
        <X size={14} />
      </button>
    </div>
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
