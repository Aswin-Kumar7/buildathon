import { useMemo, useState } from 'react';
import { Clock, Funnel, Bookmark } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { auditListResponseSchema, type AuditEntry, type IncidentDetail } from '@sentinel/contracts';
import { kindLabel } from '../incidents/audit-words.js';
import { ICON, TimelineEventCard } from './TimelineEventCard.js';
import './IncidentTimelineTab.css';
import { CustomSelectPill } from '../components/CustomSelectPill.js';

export type Tone = 'ok' | 'warn' | 'critical' | 'ai' | 'info' | 'neutral';
export type Category = 'incident' | 'attempt' | 'ai' | 'containment' | 'system';
export type IconKey =
  'flag' | 'card' | 'sparkle' | 'check' | 'cross' | 'shield' | 'workflow' | 'gear';

export interface TimelineEvent {
  key: string;
  at: number;
  date: string;
  time: string;
  ago: string;
  title: string;
  description: string;
  category: Category;
  icon: IconKey;
  node: Tone;
  badge: { label: string; tone: Tone } | null;
  actor: string | null;
  source: string;
  details: [string, string][];
}

const CATEGORY_LABEL: Record<Category, string> = {
  incident: 'Incident event',
  attempt: 'Attempt event',
  ai: 'AI recommendation',
  containment: 'Containment event',
  system: 'System event',
};
const CATEGORY_ICON: Record<Category, IconKey> = {
  incident: 'flag',
  attempt: 'card',
  ai: 'sparkle',
  containment: 'shield',
  system: 'gear',
};
const CATEGORY_NODE: Record<Category, Tone> = {
  incident: 'info',
  attempt: 'neutral',
  ai: 'ai',
  containment: 'ok',
  system: 'neutral',
};

async function fetchAudit(id: string): Promise<AuditEntry[]> {
  const response = await fetch(`/api/audit?incidentId=${id}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`api returned ${response.status}`);
  return auditListResponseSchema.parse(await response.json()).entries;
}

const fmtDate = (at: number): string =>
  new Date(at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
  ',';
const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
const fmtFull = (at: number): string => new Date(at).toLocaleString('en-IN');
function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s} sec ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const TIME_RANGES: [string, string, number | null][] = [
  ['all', 'All time', null],
  ['hour', 'Last 1 hour', 3_600_000],
  ['day', 'Last 24 hours', 86_400_000],
  ['week', 'Last 7 days', 604_800_000],
];

interface Filters {
  category: string;
  range: string;
  source: string;
}
const DEFAULT_FILTERS: Filters = { category: 'all', range: 'all', source: 'all' };
const PAGE = 6;

export function IncidentTimelineTab({ incident }: { incident: IncidentDetail }): React.JSX.Element {
  const audit = useQuery({
    queryKey: ['audit', 'incident', incident.id],
    queryFn: () => fetchAudit(incident.id),
  });
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const events = useMemo(() => buildEvents(incident, audit.data ?? []), [incident, audit.data]);
  const sources = useMemo(() => [...new Set(events.map((e) => e.source))], [events]);
  const categories = useMemo(() => [...new Set(events.map((e) => e.category))], [events]);
  const filtered = applyFilters(events, filters);
  const visible = filtered.slice(0, shown);

  const update = (patch: Partial<Filters>): void => {
    setFilters((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const toggle = (key: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="tl">
      <section
        style={{
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
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid oklch(0.955 0.006 280)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 32px',
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              background: 'oklch(0.962 0.024 258)',
            }}
          >
            <Clock size={16} color="oklch(0.46 0.12 258)" />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: '14.5px',
                fontWeight: 600,
                letterSpacing: '-0.018em',
                color: 'oklch(0.21 0.015 280)',
              }}
            >
              Incident timeline
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 500,
                color: 'oklch(0.56 0.015 280)',
              }}
            >
              Everything that happened on this incident, in order
            </p>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          {audit.isPending && <p className="tl-empty">Loading events…</p>}
          {audit.isError && (
            <p className="tl-empty" role="alert">
              The timeline could not be loaded.
            </p>
          )}
          {!audit.isPending && !audit.isError && filtered.length === 0 && (
            <p className="tl-empty">No events match the current filters.</p>
          )}
          {visible.length > 0 && (
            <ol className="tl-list">
              {visible.map((event, index) => (
                <TimelineEventCard
                  key={event.key}
                  event={event}
                  expanded={expanded.has(event.key)}
                  onToggle={() => toggle(event.key)}
                  last={index === visible.length - 1}
                />
              ))}
            </ol>
          )}
          {filtered.length > shown && (
            <button type="button" className="tl-more" onClick={() => setShown((s) => s + PAGE)}>
              Load earlier events
            </button>
          )}
        </div>
      </section>

      <aside className="tl-side">
        <FiltersCard
          filters={filters}
          sources={sources}
          categories={categories}
          onChange={update}
          onClear={() => {
            setFilters(DEFAULT_FILTERS);
            setShown(PAGE);
          }}
        />
        <LegendCard categories={categories} />
      </aside>
    </div>
  );
}

function FiltersCard({
  filters,
  sources,
  categories,
  onChange,
  onClear,
}: {
  filters: Filters;
  sources: string[];
  categories: Category[];
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}): React.JSX.Element {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        background: 'oklch(1 0 0)',
        border: '1px solid oklch(0.925 0.006 280)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid oklch(0.955 0.006 280)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 32px',
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              background: 'oklch(0.96 0.03 290)',
            }}
          >
            <Funnel size={16} color="oklch(0.45 0.14 290)" />
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: '14.5px',
              fontWeight: 600,
              letterSpacing: '-0.018em',
              color: 'oklch(0.21 0.015 280)',
            }}
          >
            Filters
          </h2>
        </div>
        <button
          type="button"
          className="tl-clear"
          onClick={onClear}
          style={{
            border: 'none',
            background: 'none',
            fontSize: '12px',
            fontWeight: 600,
            color: 'oklch(0.46 0.12 258)',
            cursor: 'pointer',
          }}
        >
          Clear all
        </button>
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <label className="tl-field-label">
          Event types
          <CustomSelectPill
            value={filters.category}
            options={[
              { value: 'all', label: 'All event types' },
              ...categories.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
            ]}
            onChange={(val) => onChange({ category: val })}
            ariaLabel="Event types"
            variant="field"
          />
        </label>
        <label className="tl-field-label">
          Time range
          <CustomSelectPill
            value={filters.range}
            options={TIME_RANGES.map(([value, label]) => ({
              value,
              label,
            }))}
            onChange={(val) => onChange({ range: val })}
            ariaLabel="Time range"
            variant="field"
          />
        </label>
        <label className="tl-field-label">
          Source
          <CustomSelectPill
            value={filters.source}
            options={[
              { value: 'all', label: 'All sources' },
              ...sources.map((s) => ({ value: s, label: s })),
            ]}
            onChange={(val) => onChange({ source: val })}
            ariaLabel="Source"
            variant="field"
          />
        </label>
      </div>
    </section>
  );
}

function LegendCard({ categories }: { categories: Category[] }): React.JSX.Element {
  return (
    <div className="tl-legend">
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '12px',
          background: 'oklch(1 0 0)',
          border: '1px solid oklch(0.925 0.006 280)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid oklch(0.955 0.006 280)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 32px',
              width: '32px',
              height: '32px',
              borderRadius: '9px',
              background: 'oklch(0.96 0.03 162)',
            }}
          >
            <Bookmark size={16} color="oklch(0.4 0.11 162)" />
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: '14.5px',
              fontWeight: 600,
              letterSpacing: '-0.018em',
              color: 'oklch(0.21 0.015 280)',
            }}
          >
            Legend
          </h2>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {categories.map((c) => {
              const Icon = ICON[CATEGORY_ICON[c]];
              return (
                <li
                  key={c}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '12.5px',
                    fontWeight: 500,
                    color: 'oklch(0.35 0.015 280)',
                  }}
                >
                  <span className={`tl-node tl-node--sm tl-node--${CATEGORY_NODE[c]}`}>
                    <Icon />
                  </span>
                  {CATEGORY_LABEL[c]}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </div>
  );
}

// ── event construction ──────────────────────────────────────────────────────────────────────────

function applyFilters(events: TimelineEvent[], f: Filters): TimelineEvent[] {
  const window = TIME_RANGES.find(([v]) => v === f.range)?.[2] ?? null;
  const floor = window === null ? null : Date.now() - window;
  return events.filter(
    (e) =>
      (f.category === 'all' || e.category === f.category) &&
      (f.source === 'all' || e.source === f.source) &&
      (floor === null || e.at >= floor),
  );
}

function base(at: number): Pick<TimelineEvent, 'at' | 'date' | 'time' | 'ago'> {
  return { at, date: fmtDate(at), time: fmtTime(at), ago: ago(at) };
}

function buildEvents(incident: IncidentDetail, entries: AuditEntry[]): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      ...base(incident.firstAttemptAt),
      key: 'anchor-attempt',
      title: 'First attempt in window',
      description: 'The earliest payment attempt connected to this incident.',
      category: 'attempt',
      icon: 'card',
      node: 'neutral',
      badge: null,
      actor: null,
      source: 'Payment gateway',
      details: [
        ['Incident ID', incident.id],
        ['Timestamp', fmtFull(incident.firstAttemptAt)],
        ['Source', 'Payment gateway'],
      ],
    },
    {
      ...base(incident.detectedAt),
      key: 'anchor-detected',
      title: 'Incident detected',
      description: `Sentinel opened this incident ${Math.round(incident.timeToDetectMs / 1000)}s after the first payment attempt.`,
      category: 'incident',
      icon: 'flag',
      node: 'info',
      badge: { label: 'Detected', tone: 'info' },
      actor: null,
      source: 'Detection engine',
      details: [
        ['Incident ID', incident.id],
        ['Timestamp', fmtFull(incident.detectedAt)],
        ['Detector', 'Rules + correlation'],
        ['Time to detect', `${Math.round(incident.timeToDetectMs / 1000)}s`],
      ],
    },
    ...entries.map((entry) => auditToEvent(incident, entry)),
  ];
  return events.sort((a, b) => b.at - a.at);
}

interface KindMeta {
  category: Category;
  icon: IconKey;
  node: Tone;
  badge: [string, Tone] | null;
}
const KIND_META: Record<string, KindMeta> = {
  'incident.transition': { category: 'incident', icon: 'workflow', node: 'info', badge: null },
  'recommendation.accepted': {
    category: 'ai',
    icon: 'sparkle',
    node: 'ai',
    badge: ['Accepted', 'ok'],
  },
  'recommendation.rejected': {
    category: 'ai',
    icon: 'sparkle',
    node: 'ai',
    badge: ['Declined', 'critical'],
  },
  'containment.proposed': {
    category: 'containment',
    icon: 'shield',
    node: 'warn',
    badge: ['Proposed', 'warn'],
  },
  'containment.approved': {
    category: 'containment',
    icon: 'check',
    node: 'ok',
    badge: ['Approved', 'ok'],
  },
  'containment.activated': {
    category: 'containment',
    icon: 'check',
    node: 'ok',
    badge: ['Applied', 'ok'],
  },
  'containment.rejected': {
    category: 'containment',
    icon: 'cross',
    node: 'critical',
    badge: ['Rejected', 'critical'],
  },
  'containment.released': {
    category: 'containment',
    icon: 'shield',
    node: 'neutral',
    badge: ['Released', 'neutral'],
  },
  'containment.expired': {
    category: 'containment',
    icon: 'shield',
    node: 'neutral',
    badge: ['Expired', 'neutral'],
  },
};

function auditToEvent(incident: IncidentDetail, e: AuditEntry): TimelineEvent {
  const meta = KIND_META[e.kind] ?? {
    category: 'system',
    icon: 'gear',
    node: 'neutral',
    badge: null,
  };
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const badge =
    e.kind === 'incident.transition' && typeof p['to'] === 'string'
      ? { label: String(p['to']).replace(/_/g, ' '), tone: statusTone(String(p['to'])) }
      : meta.badge !== null
        ? { label: meta.badge[0], tone: meta.badge[1] }
        : null;
  return {
    ...base(e.at),
    key: `a-${e.seq}`,
    title: kindLabel(e.kind),
    description: describe(e, p),
    category: meta.category,
    icon: meta.icon,
    node: meta.node,
    badge,
    actor: e.actor,
    source: e.actor === null ? 'System' : 'Console',
    details: auditDetails(incident, e, p),
  };
}

function describe(e: AuditEntry, p: Record<string, unknown>): string {
  const note = typeof p['note'] === 'string' && p['note'] !== '' ? ` — ${String(p['note'])}` : '';
  const action = typeof p['action'] === 'string' ? String(p['action']) : '—';
  switch (e.kind) {
    case 'incident.transition':
      return `Incident moved from ${String(p['from'] ?? '?').replace(/_/g, ' ')} to ${String(p['to'] ?? '?').replace(/_/g, ' ')}${note}.`;
    case 'recommendation.accepted':
      return `Sentinel’s recommendation (${action}) accepted${note}.`;
    case 'recommendation.rejected':
      return `Sentinel’s recommendation (${action}) declined${note}.`;
    case 'containment.proposed':
      return `An action was proposed for approval${note}.`;
    case 'containment.approved':
      return `The action was approved${note}.`;
    case 'containment.activated':
      return 'The action is now in effect.';
    case 'containment.rejected':
      return `The action was rejected${note}.`;
    case 'containment.released':
      return `The action was lifted early${note}.`;
    case 'containment.expired':
      return 'The action expired on its own.';
    default:
      return kindLabel(e.kind) + note;
  }
}

function auditDetails(
  incident: IncidentDetail,
  e: AuditEntry,
  p: Record<string, unknown>,
): [string, string][] {
  const rows: [string, string][] = [
    ['Event ID', e.hash.slice(0, 12)],
    ['Incident ID', incident.id],
    ['Timestamp', fmtFull(e.at)],
    ['Event type', e.kind],
    ['Actor', e.actor ?? 'System'],
  ];
  const str = (k: string): string | null => (typeof p[k] === 'string' ? String(p[k]) : null);
  if (str('action')) rows.push(['Action', str('action')!]);
  if (str('alignment')) rows.push(['Alignment', str('alignment')!]);
  if (str('reasoningVersion')) rows.push(['Reasoning version', str('reasoningVersion')!]);
  if (str('groundingHash'))
    rows.push(['Provenance (grounding)', str('groundingHash')!.slice(0, 12)]);
  if (str('from') && str('to')) rows.push(['Transition', `${str('from')} → ${str('to')}`]);
  if (e.policyVersion !== null) rows.push(['Policy version', String(e.policyVersion)]);
  if (e.policyHash !== null) rows.push(['Policy hash', e.policyHash]);
  if (str('note')) rows.push(['Note', str('note')!]);
  return rows;
}

function statusTone(status: string): Tone {
  if (status === 'contained') return 'ok';
  if (status === 'under_review') return 'warn';
  if (status === 'resolved') return 'ok';
  if (status === 'expired') return 'neutral';
  return 'info';
}
