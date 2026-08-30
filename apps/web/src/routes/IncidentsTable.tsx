import type { IncidentSummary } from '@sentinel/contracts';
import { WarningCircle, Sparkle, ArrowRight } from '@phosphor-icons/react';
import { bucketOf, type Bucket } from './IncidentsSummary.js';
import { FilterRow, type FilterRowProps } from './IncidentsPage.js';

const PAGE_SIZE = 10;

const incidentRef = (id: string): string => `INC-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

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
  new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const stampTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** What Sentinel recommends a merchant do about this row, in a merchant's words — real backend field. */
const RECOMMENDATION: Record<
  IncidentSummary['recommendedDecision'],
  { label: string; tone: string }
> = {
  contain: { label: 'Block', tone: 'block' },
  review: { label: 'Review', tone: 'review' },
  monitor: { label: 'Monitor', tone: 'monitor' },
  none: { label: 'Watch', tone: 'monitor' },
};

function BucketIcon({ bucket }: { bucket?: Bucket }): React.JSX.Element {
  return <WarningCircle />;
}

function relationship(incident: IncidentSummary): string {
  const parts: string[] = [];
  if (incident.distinctCards !== null && incident.distinctCards > 0) {
    parts.push(`${incident.distinctCards} ${incident.distinctCards === 1 ? 'card' : 'cards'}`);
  }
  parts.push(incident.entityKind);
  return parts.join(' · ');
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
  const live = incident.source === 'razorpay';
  const needsAction = incident.status === 'open' || incident.status === 'under_review';
  const rec = RECOMMENDATION[incident.recommendedDecision];
  return (
    <tr className="inct-row" onClick={() => onOpen(incident.id)}>
      <td className="inct-inc">
        <span className={`inct-ico inct-ico--${bucket}`}>
          <BucketIcon bucket={bucket} />
        </span>
        <span className="inct-inc__text">
          <strong>{incident.title}</strong>
          <span className="inct-ref">{incidentRef(incident.id)}</span>
          <span className="inct-rel">{relationship(incident)}</span>
        </span>
      </td>
      <td>
        <span className={`inct-risk inct-risk--${bucket}`}>{BUCKET_LABEL[bucket]}</span>
        <span className="inct-score">
          {Math.round(incident.score * 100)}
          <small>/100</small>
        </span>
      </td>
      <td>
        <span className={`inct-status inct-status--${pill.tone}`}>{pill.label}</span>
        <span className="inct-sub">{pill.sub}</span>
      </td>
      <td>
        <span className="inct-src">
          <i className={`inct-dot inct-dot--${live ? 'live' : 'sim'}`} aria-hidden="true" />
          {live ? 'Live' : 'Simulated'}
        </span>
        <span className="inct-sub">{live ? 'Razorpay' : 'Simulation'}</span>
      </td>
      <td className="inct-when">
        <span>{stampDate(incident.detectedAt)}</span>
        <span className="inct-sub">{stampTime(incident.detectedAt)}</span>
        <span className="inct-sub">{ago(incident.detectedAt)}</span>
      </td>
      <td className="inct-att">
        <strong>{incident.attempts}</strong>
        <span className="inct-sub">{incident.failures} failed</span>
      </td>
      <td className="inct-act">
        {needsAction && (
          <span className={`inct-rec inct-rec--${rec.tone}`} title="Sentinel's recommended action">
            <Sparkle /> {rec.label}
          </span>
        )}
        <button
          type="button"
          className="inct-review"
          aria-label={`Review ${incident.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(incident.id);
          }}
        >
          Review <ArrowRight />
        </button>
      </td>
    </tr>
  );
}

const HEADERS = ['Incident', 'Risk', 'Status', 'Source', 'First detected', 'Attempts', ''];

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

      <div className="inct-wrap">
        <table className="inct">
          <thead>
            <tr>
              {HEADERS.map((h, index) => (
                <th key={h || `a${index}`}>{h}</th>
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
        <div className="inct-foot">
          <span className="inct-summary">
            Showing <strong>{(current - 1) * PAGE_SIZE + 1}</strong> to{' '}
            <strong>{Math.min(current * PAGE_SIZE, incidents.length)}</strong> of{' '}
            <strong>{incidents.length}</strong> incidents
          </span>
          <nav className="inct-pager" aria-label="Pagination">
            <button
              type="button"
              className="inct-pager__btn"
              disabled={current <= 1}
              onClick={() => onPage(current - 1)}
              aria-label="Previous page"
            >
              Prev
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                className={`inct-pager__num${p === current ? ' is-active' : ''}`}
                aria-current={p === current ? 'page' : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              className="inct-pager__btn"
              disabled={current >= pageCount}
              onClick={() => onPage(current + 1)}
              aria-label="Next page"
            >
              Next
            </button>
          </nav>
        </div>
      )}
    </section>
  );
}
