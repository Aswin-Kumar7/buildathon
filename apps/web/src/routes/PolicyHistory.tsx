import { Badge } from '@sentinel/ui';
import type { PolicyVersion } from '@sentinel/contracts';
import { STATUS_LABEL, STATUS_TONE } from './policy-draft.js';
import { Modal, fmtDateTime } from './policy-ui.js';

const RECENT = 5;

/**
 * The real governance trail from GET /api/policy/versions — who drafted, submitted, approved,
 * published or rejected each version, and when. There is no stored "what changed" summary, so the
 * page does not invent one; it shows the lifecycle facts the backend actually keeps.
 */
export function PolicyHistoryCard({
  versions,
  loading,
  error,
  onViewAll,
}: {
  versions: PolicyVersion[];
  loading: boolean;
  error: string | null;
  onViewAll: () => void;
}): React.JSX.Element {
  return (
    <section className="pol-card pol-history">
      <header className="pol-history__head">
        <div>
          <h2>Policy history</h2>
          <p>A log of changes made to your policy.</p>
        </div>
        {versions.length > RECENT && (
          <button type="button" className="pol-history__all" onClick={onViewAll}>
            View all history
          </button>
        )}
      </header>
      {error !== null ? (
        <p className="pol-history__empty" role="alert">
          Could not load history. {error}
        </p>
      ) : loading ? (
        <p className="pol-history__empty" role="status">
          Loading history…
        </p>
      ) : versions.length === 0 ? (
        <p className="pol-history__empty">
          No policy changes yet. The active policy is the committed baseline.
        </p>
      ) : (
        <HistoryTable versions={versions.slice(0, RECENT)} />
      )}
    </section>
  );
}

export function HistoryModal({
  versions,
  loading,
  onClose,
}: {
  versions: PolicyVersion[];
  loading: boolean;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal
      title="Policy history"
      subtitle="Every policy version and where it is in review."
      onClose={onClose}
      wide
    >
      {loading ? (
        <p className="pol-history__empty" role="status">
          Loading history…
        </p>
      ) : versions.length === 0 ? (
        <p className="pol-history__empty">No policy changes yet.</p>
      ) : (
        <HistoryTable versions={versions} showHash />
      )}
    </Modal>
  );
}

function HistoryTable({
  versions,
  showHash,
}: {
  versions: PolicyVersion[];
  showHash?: boolean;
}): React.JSX.Element {
  return (
    <div className="pol-history__wrap">
      <table className="pol-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Created by</th>
            <th>Created</th>
            <th>Approved by</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id}>
              <td>
                <strong>v{version.version}</strong>
                {showHash === true && <code className="pol-table__hash">{version.hash}</code>}
              </td>
              <td>
                <Badge tone={STATUS_TONE[version.status]}>{STATUS_LABEL[version.status]}</Badge>
              </td>
              <td>{version.createdByName ?? '—'}</td>
              <td className="pol-table__when">{fmtDateTime(version.createdAt)}</td>
              <td>{version.approvedByName ?? '—'}</td>
              <td className="pol-table__when">{fmtDateTime(version.publishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
