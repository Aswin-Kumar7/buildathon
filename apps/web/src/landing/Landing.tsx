import { Link } from '@tanstack/react-router';
import { Button, Callout, Card } from '@sentinel/ui';
import { useMeta } from './useMeta.js';
import { EvidenceTable } from './EvidenceTable.js';
import { Pipeline } from './Pipeline.js';

export function Landing(): React.JSX.Element {
  const state = useMeta();

  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">
          Razorpay AI Buildathon · Track 02 · AI Risk Manager
          {state.kind === 'ready' &&
            ` · slice ${state.meta.slice.number} — ${state.meta.slice.name}`}
        </p>
        <h1>Sentinel</h1>
        <p className="claim">
          {state.kind === 'ready'
            ? state.meta.claim
            : 'Merchant-side detection and safe response for suspicious failed-payment clusters.'}
        </p>
      </header>

      <Callout tone="neutral" title="What this is not">
        <p>
          Sentinel is not equivalent to Razorpay&rsquo;s production fraud platform, is not trained
          on Razorpay data, and cannot stop all card-testing attempts. Its claim is evidence
          quality, safety controls and evaluation rigour.
        </p>
      </Callout>

      <section>
        <h2>Evidence boundary</h2>
        {state.kind === 'loading' && <p role="status">Reading project status&hellip;</p>}
        {state.kind === 'error' && (
          <Callout tone="warn" title="API unreachable">
            <p role="alert">
              {state.message}. Start it with <code>pnpm dev</code>; this page reports status from
              the running system rather than from a hardcoded list.
            </p>
          </Callout>
        )}
        {state.kind === 'ready' && <EvidenceTable layers={state.meta.evidenceLayers} />}
      </section>

      <section>
        <h2>How it works</h2>
        <Pipeline />
      </section>

      <section>
        <h2>Run it</h2>
        <Card>
          <div className="actions">
            <Link to="/login">
              <Button variant="primary">Open the console</Button>
            </Link>
            <Button variant="secondary" disabled>
              Replay demo
            </Button>
            <Button variant="secondary" disabled>
              Integration verification
            </Button>
          </div>
          <p className="action-note">
            The console is live. The replay demo runs from a clean clone with no credentials, and
            integration verification needs your own Razorpay test keys &mdash; both arrive with the
            slices that make them real, and stay disabled until then rather than pretending to work.
          </p>
        </Card>
      </section>

      <footer className="footer">
        {state.kind === 'ready' && (
          <p>
            version {state.meta.version} &middot; commit {state.meta.commit}
          </p>
        )}
      </footer>
    </main>
  );
}
