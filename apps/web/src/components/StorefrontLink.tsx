import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStorefrontUrl } from '../links.js';
import './StorefrontLink.css';

/**
 * A link to the demo storefront that says what is about to happen before it happens.
 *
 * The storefront scales to zero when nobody is using it, so the first request after an idle
 * period waits for a container to start. That takes around ten seconds, and the tab is blank
 * for all of them. With no warning it reads as a dead link, and the usual reaction is to close
 * the tab a second before it would have loaded.
 *
 * So a plain click opens a notice instead of the tab, and the wake request goes out at the same
 * moment — the ten seconds run while the notice is being read rather than after it. Modifier
 * clicks, middle clicks and "open in new tab" are left alone, because someone doing that has
 * already decided how they want the link to behave.
 */

/**
 * Whether a click has to warn before it opens anything.
 *
 * Only the dev server's storefront is always awake, so localhost is the single exemption. Anything
 * else is a container that scales to zero.
 *
 * An earlier version also required the address to be cross-origin, which was wrong: a deployment
 * that has not set STOREFRONT_URL yet renders a same-origin link, so the notice suppressed itself
 * in exactly the case it exists for. A same-origin link on a deployment still resolves to a hosted
 * container, and that container still sleeps.
 */
function sleepsWhenIdle(url: string): boolean {
  try {
    const { hostname } = new URL(url, window.location.href);
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
}

/** Fire-and-forget. The response is opaque and unwanted; the point is that the container starts. */
function startWaking(url: string): void {
  void fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {
    // A failed warm-up costs nothing — the real navigation will wake it anyway, just later.
  });
}

function ColdStartNotice({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sfw-scrim" onClick={onClose}>
      <div
        className="sfw-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sfw-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sfw-eyebrow">
          <span className="sfw-dot" />
          Cold start
        </span>

        <h2 className="sfw-title" id="sfw-title">
          The storefront is waking up
        </h2>
        <p className="sfw-body">
          It sleeps when nobody is using it, so the first visit waits about ten seconds for a
          container to start. The tab stays blank until it does. Leave it open and the shop appears.
        </p>

        <div className="sfw-track" aria-hidden="true">
          <div className="sfw-fill" />
        </div>

        <div className="sfw-actions">
          <button type="button" className="sfw-btn sfw-btn--ghost" onClick={onClose}>
            Not now
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="sfw-btn sfw-btn--go"
            onClick={() => {
              window.open(url, '_blank', 'noopener,noreferrer');
              onClose();
            }}
          >
            Open the storefront
          </button>
        </div>
      </div>
    </div>
  );
}

export function StorefrontLink({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const url = useStorefrontUrl();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <a
        className={className}
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (!sleepsWhenIdle(url)) return;
          event.preventDefault();
          startWaking(url);
          setAsking(true);
        }}
      >
        {children}
      </a>
      {asking && <ColdStartNotice url={url} onClose={() => setAsking(false)} />}
    </>
  );
}
