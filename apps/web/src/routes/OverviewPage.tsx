import { Callout, Card } from '@sentinel/ui';
import { useSession } from '../auth/useSession.js';
import { useMeta } from '../landing/useMeta.js';
import { EvidenceTable } from '../landing/EvidenceTable.js';

export function OverviewPage(): React.JSX.Element {
  const { user } = useSession();
  const meta = useMeta();

  return (
    <>
      <header className="page-head">
        <h1>Overview</h1>
        <p>
          Signed in as {user?.displayName ?? 'unknown'}. Every action you take from here is recorded
          against this identity.
        </p>
      </header>

      <Callout tone="info" title="Events are arriving, but nothing is detecting yet">
        <p>
          Payment events from Razorpay are being verified, stored and redacted &mdash; System health
          shows that happening live. No detector reads them yet. Sections in the sidebar without a
          link are not built; they show the slice that makes them real rather than pretending to
          work.
        </p>
      </Callout>

      <section>
        <h2>Evidence status</h2>
        {meta.kind === 'ready' ? (
          <EvidenceTable layers={meta.meta.evidenceLayers} />
        ) : (
          <p role="status">Reading project status…</p>
        )}
      </section>

      <section>
        <h2>What lands next</h2>
        <Card>
          <p>
            <strong>Slice 3 — storefront and Razorpay orders.</strong> A demo checkout that creates
            real test-mode orders and captures the request context that Razorpay&rsquo;s webhooks do
            not carry: hashed IP, device and session. That context is the sensor the whole detector
            depends on.
          </p>
        </Card>
      </section>
    </>
  );
}
