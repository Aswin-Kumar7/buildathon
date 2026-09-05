import type { IncidentSummary } from '@sentinel/contracts';
import {
  CreditCard,
  WarningCircle,
  ArrowRight,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import { bucketOf, type Bucket } from './IncidentsSummary.js';
import { FilterRow, type FilterRowProps } from './IncidentsPage.js';

const PAGE_SIZE = 10;

const incidentRef = (id: string): string => `INC–${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

const BUCKET_LABEL: Record<Bucket, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

function statusPill(status: IncidentSummary['status']): {
  label: string;
  tone: string;
  sub: string;
} {
  switch (status) {
    case 'open':
      return { label: 'Active', tone: 'active', sub: 'Detected' };
    case 'under_review':
      return { label: 'Under review', tone: 'review', sub: 'Detected' };
    case 'contained':
      return { label: 'Contained', tone: 'ok', sub: 'Enforced' };
    case 'resolved':
      return { label: 'Resolved', tone: 'ok', sub: 'Closed' };
    default:
      return { label: 'Expired', tone: 'neutral', sub: 'Aged out' };
  }
}

const stampDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const stampTime = (ms: number): string =>
  new Date(ms)
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    .toLowerCase();

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

function relationship(incident: IncidentSummary): string {
  const parts: string[] = [];
  if (incident.distinctCards !== null && incident.distinctCards > 0) {
    parts.push(`${incident.distinctCards} ${incident.distinctCards === 1 ? 'card' : 'cards'}`);
  }
  parts.push(incident.entityKind);
  return parts.join(' · ');
}

/**
 * The score, drawn to length.
 *
 * This used to be four segments filled by `ceil(score / 25)`, which is a four-value bucket wearing
 * the costume of a meter: every score from 76 to 100 lit all four segments identically, so a queue
 * of 78s and 99s looked the same. The bar now measures — its width is the score — and the colour
 * still steps at the band boundaries the rest of the console uses.
 */
function RiskMeter({ score }: { score: number }): React.JSX.Element {
  const scorePct = Math.min(100, Math.max(0, score <= 1 ? score * 100 : score));
  const tone = scorePct > 75 ? 'red' : scorePct > 45 ? 'yellow' : 'green';

  return (
    <div className={`inct-risk-meter inct-risk-meter--${tone}`} aria-hidden="true">
      <span className="inct-risk-fill" style={{ width: `${scorePct}%` }} />
    </div>
  );
}

function IncidentRow({
  incident,
  onOpen,
}: {
  incident: IncidentSummary;
  onOpen: (id: string) => void;
}): React.JSX.Element {
  const bucket = bucketOf(incident);
  const pill = statusPill(incident.status);
  const isSim = incident.source === 'replay';
  const failPct =
    incident.attempts > 0
      ? Math.min(100, Math.max(0, (incident.failures / incident.attempts) * 100))
      : 0;

  return (
    <tr className="inct-row" onClick={() => onOpen(incident.id)}>
      {/* 1. Incident Details */}
      <td className="inct-col inct-col--inc">
        <div className="inct-inc-wrap">
          <span className={`inct-plate inct-plate--${bucket}`} aria-hidden="true">
            {bucket === 'critical' || bucket === 'high' ? (
              <CreditCard size={16} />
            ) : (
              <WarningCircle size={16} />
            )}
          </span>
          <div className="inct-inc-text">
            <span className="inct-inc-title">{incident.title}</span>
            <span className="inct-inc-sub">
              {incidentRef(incident.id)} · {relationship(incident)}
            </span>
          </div>
        </div>
      </td>

      {/* 2. Risk Score & Multi-segment Meter */}
      <td className="inct-col inct-col--risk">
        <div className="inct-risk-wrap">
          <div className="inct-risk-score-line">
            <span className={`inct-score-num inct-score-num--${bucket}`}>
              {Math.round(incident.score * 100)}
            </span>
            <span className="inct-score-max">/100</span>
          </div>
          <RiskMeter score={incident.score} />
          <span className={`inct-tier-tag inct-tier-tag--${bucket}`}>{BUCKET_LABEL[bucket]}</span>
        </div>
      </td>

      {/* 3. Status Pill & Stage */}
      <td className="inct-col inct-col--status">
        <div className="inct-status-wrap">
          <span className={`inct-status-pill inct-status-pill--${pill.tone}`}>{pill.label}</span>
          <span className="inct-status-sub">{pill.sub}</span>
        </div>
      </td>

      {/* 4. Source */}
      <td className="inct-col inct-col--source">
        <div className="inct-source-wrap">
          <span className="inct-source-line">
            <span
              className={`inct-source-dot inct-source-dot--${isSim ? 'sim' : 'live'}`}
              aria-hidden="true"
            />
            {isSim ? 'Simulated' : 'Live'}
          </span>
          <span className="inct-source-sub">{isSim ? 'Simulation' : 'Storefront'}</span>
        </div>
      </td>

      {/* 5. First detected */}
      <td className="inct-col inct-col--when">
        <div className="inct-when-wrap">
          <span className="inct-when-date">{stampDate(incident.detectedAt)}</span>
          <span className="inct-when-time">
            {stampTime(incident.detectedAt)} · {ago(incident.detectedAt)}
          </span>
        </div>
      </td>

      {/* 6. Attempts & Failure bar */}
      <td className="inct-col inct-col--attempts">
        <div className="inct-attempts-wrap">
          <span className="inct-attempts-count">{incident.attempts}</span>
          <div className="inct-attempts-bar" aria-hidden="true">
            <span className="inct-attempts-bar-fail" style={{ width: `${failPct}%` }} />
          </div>
          <span className="inct-attempts-sub">{incident.failures} failed</span>
        </div>
      </td>

      {/* 7. Action buttons */}
      <td className="inct-col inct-col--action">
        <div className="inct-action-wrap">
          <span style={{ display: 'none' }}>
            {incident.recommendedDecision === 'review' ? 'Block' : 'Block'}
          </span>
          <button
            type="button"
            className="inct-btn-review"
            aria-label={`Review ${incident.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(incident.id);
            }}
          >
            Review <ArrowRight size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

const HEADERS = ['Incident', 'Risk', 'Status', 'Source', 'First detected', 'Attempts', 'Action'];

function TableFooter({
  total,
  current,
  pageCount,
  onPage,
}: {
  total: number;
  current: number;
  pageCount: number;
  onPage: (page: number) => void;
}): React.JSX.Element {
  const start = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const end = Math.min(current * PAGE_SIZE, total);

  return (
    <div className="inct-foot">
      <span className="inct-foot-summary">
        Showing <strong>{start}</strong> to <strong>{end}</strong> of <strong>{total}</strong>{' '}
        {total === 1 ? 'incident' : 'incidents'}
      </span>
      <div className="inct-foot-pager">
        <button
          type="button"
          className="inct-pager-btn"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
          aria-label="Previous page"
        >
          <CaretLeft size={13} />
        </button>
        <span className="inct-pager-page">{current}</span>
        <span className="inct-pager-of">of {pageCount}</span>
        <button
          type="button"
          className="inct-pager-btn"
          disabled={current >= pageCount}
          onClick={() => onPage(current + 1)}
          aria-label="Next page"
        >
          <CaretRight size={13} />
        </button>
      </div>
    </div>
  );
}

export function IncidentsTable({
  incidents,
  loading,
  error,
  page,
  onPage,
  onOpen,
  filterProps,
}: {
  incidents: IncidentSummary[];
  loading: boolean;
  error: string | null;
  page: number;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
  filterProps?: FilterRowProps;
}): React.JSX.Element {
  const pageCount = Math.max(1, Math.ceil(incidents.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const shown = incidents.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <section className="inct-panel">
      {filterProps && <FilterRow {...filterProps} />}

      <div className="om-scroll">
        <table className="inct-table" role="table">
          <thead>
            <tr className="inct-head-row">
              {HEADERS.map((h) => (
                <th
                  key={h}
                  className={`inct-th-cell${h === 'Action' ? ' inct-th-cell--right' : ''}${
                    // Status is the one centred column, so its header sits over its pill.
                    h === 'Status' ? ' inct-th-cell--center' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="inct-empty">Loading incidents…</p>}
      {error !== null && (
        <p className="inct-empty" role="alert">
          Could not load incidents: {error}
        </p>
      )}
      {!loading && error === null && incidents.length === 0 && (
        <p className="inct-empty">No incidents match these filters.</p>
      )}
      {incidents.length > 0 && (
        <TableFooter
          total={incidents.length}
          current={current}
          pageCount={pageCount}
          onPage={onPage}
        />
      )}
    </section>
  );
}
