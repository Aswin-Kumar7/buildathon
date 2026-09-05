import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { type PolicyVersion } from '@sentinel/contracts';
import {
  ArrowLeft,
  MagnifyingGlass,
  Funnel,
  User,
  DownloadSimple,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import { STATUS_LABEL, STATUS_TONE } from './policy-draft.js';
import { fmtDateTime } from './policy-ui.js';
import { CustomSelectPill } from '../components/CustomSelectPill.js';
import { fetchPolicyVersions as fetchVersions } from '../shared/fetchers.js';

export function PolicyHistoryPage({
  versions: versionsProp,
  onBack,
}: {
  versions?: PolicyVersion[];
  onBack?: () => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [recordFilter, setRecordFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const versionsQuery = useQuery({ queryKey: ['policy-versions'], queryFn: fetchVersions });
  const realVersions = versionsProp ?? versionsQuery.data ?? [];

  const realRows = realVersions.map((v) => {
    const author = v.createdByName ?? v.approvedByName ?? 'Demo Admin';
    const initials = author
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    return {
      ver: `v${v.version}`,
      title:
        v.status === 'approved'
          ? 'Policy published'
          : v.status === 'pending_approval'
            ? 'Draft submitted'
            : v.status === 'rejected'
              ? 'Draft rejected'
              : 'Draft created',
      desc:
        v.status === 'published'
          ? "Seeded from Sentinel's shipped defaults"
          : `Version ${v.version} (${STATUS_LABEL[v.status]})`,
      state: STATUS_LABEL[v.status],
      tone:
        STATUS_TONE[v.status] === 'ok'
          ? 'active'
          : STATUS_TONE[v.status] === 'warn'
            ? 'review'
            : 'neutral',
      byInitials: initials,
      byName: author,
      when: fmtDateTime(v.publishedAt ?? v.createdAt),
      hash: v.hash.slice(0, 8),
    };
  });

  // Real versions only. This table sits under an "Append-only" badge and a line promising every
  // change "in the order it happened", so a placeholder here is not a neutral empty state — it is
  // six invented actors, hashes and timestamps presented as a tamper-evident record.
  const historyRows = realRows;

  const filtered = historyRows.filter((r) => {
    const q = search.toLowerCase();
    return (
      q === '' ||
      r.title.toLowerCase().includes(q) ||
      r.hash.toLowerCase().includes(q) ||
      r.byName.toLowerCase().includes(q)
    );
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const start = filtered.length === 0 ? 0 : (clampedPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(clampedPage * PAGE_SIZE, filtered.length);
  const pagedRows = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  return (
    <div className="pol-hist-page">
      <Link to="/console/policy" className="pol-hist-back" onClick={onBack}>
        <ArrowLeft size={14} /> Policy
      </Link>

      <header className="pol-hist-head">
        <div className="pol-hist-head__title-row">
          <h1>Policy history</h1>
          <span className="pol-hist-badge">Append-only</span>
        </div>
        <p>
          Every policy version, draft and enforcement change on this account, in the order it
          happened. Versions are never edited in place — each change creates a new record with its
          own hash.
        </p>
      </header>

      <div className="pol-hist-toolbar">
        <div className="pol-hist-search">
          <MagnifyingGlass size={15} />
          <input
            type="search"
            value={search}
            placeholder="Search versions or hashes..."
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="pol-hist-filters">
          <CustomSelectPill
            value={recordFilter}
            options={[{ value: 'all', label: 'All records' }]}
            onChange={(val) => {
              setRecordFilter(val);
              setPage(1);
            }}
            ariaLabel="Filter records"
            icon={<Funnel size={14} />}
          />
          <CustomSelectPill
            value={userFilter}
            options={[{ value: 'all', label: 'All users' }]}
            onChange={(val) => {
              setUserFilter(val);
              setPage(1);
            }}
            ariaLabel="Filter users"
            icon={<User size={14} />}
          />
          <button type="button" className="pol-hist-export-btn">
            <DownloadSimple size={14} /> Export CSV
          </button>
        </div>
      </div>

      <div className="pol-hist-table-wrap">
        <table className="pol-hist-table">
          <thead>
            <tr>
              <th>VER</th>
              <th>WHAT CHANGED</th>
              <th>STATE</th>
              <th>BY</th>
              <th>WHEN</th>
              <th>HASH</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 && (
              <tr>
                <td colSpan={6} className="pol-hist-empty">
                  No policy versions recorded yet. The first entry appears here when a draft is
                  published.
                </td>
              </tr>
            )}
            {pagedRows.map((r, i) => (
              <tr key={r.hash + i}>
                <td className="pol-hist-ver">
                  <span>{r.ver}</span>
                </td>
                <td className="pol-hist-change">
                  <span className="pol-hist-change__title">{r.title}</span>
                  <span className="pol-hist-change__desc">{r.desc}</span>
                </td>
                <td>
                  <span className={`pol-hist-pill pol-hist-pill--${r.tone}`}>{r.state}</span>
                </td>
                <td>
                  <div className="pol-hist-by">
                    <span className="pol-hist-avatar">{r.byInitials}</span>
                    <span>{r.byName}</span>
                  </div>
                </td>
                <td className="pol-hist-when">{r.when}</td>
                <td>
                  <code className="pol-hist-hash">{r.hash}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="pol-hist-foot">
          <span>
            Showing <strong>{start}</strong> to <strong>{end}</strong> of{' '}
            <strong>{filtered.length}</strong> {filtered.length === 1 ? 'record' : 'records'}
          </span>
          <div className="pol-hist-pager">
            <button
              type="button"
              className="pol-hist-pager-btn"
              disabled={clampedPage <= 1}
              onClick={() => setPage(clampedPage - 1)}
              aria-label="Previous page"
            >
              <CaretLeft size={13} />
            </button>
            <span className="pol-hist-pager-page">{clampedPage}</span>
            <span className="pol-hist-pager-of">of {pageCount}</span>
            <button
              type="button"
              className="pol-hist-pager-btn"
              disabled={clampedPage >= pageCount}
              onClick={() => setPage(clampedPage + 1)}
              aria-label="Next page"
            >
              <CaretRight size={13} />
            </button>
          </div>
          <span className="pol-hist-foot-note">Each record is linked into the audit chain</span>
        </footer>
      </div>
    </div>
  );
}
