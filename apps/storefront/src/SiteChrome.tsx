import { CupScene } from './SceneArt.js';

/** The roaster's mark: a cup whose saucer doubles as the shield Sentinel watches it with. */
function BrandMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="brand__mark">
      <path
        d="M7 11 h15 v8 a7.5 7.5 0 0 1-15 0 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M22 12.5 h2.5 a3.5 3.5 0 0 1 0 7H22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        d="M11 7.5 c0-2 2.5-2 2.5-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 7.5 c0-2 2.5-2 2.5-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M6 24 h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

const LINKS: [string, string][] = [
  ['Home', '#top'],
  ['Shop', '#shop'],
  ['Our craft', '#craft'],
  ['Visit', '#visit'],
];

export function SiteNav({
  cartCount,
  onOpenCart,
}: {
  cartCount: number;
  onOpenCart: () => void;
}): React.JSX.Element {
  return (
    <header className="nav">
      <div className="nav__inner">
        <a className="brand" href="#top">
          <BrandMark />
          Sentinel Coffee
        </a>

        <nav className="nav__links" aria-label="Primary">
          {LINKS.map(([label, href]) => (
            <a key={label} href={href}>
              {label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          className="nav__cart"
          onClick={onOpenCart}
          aria-label={cartCount === 0 ? 'See cart' : `See cart, ${cartCount} items`}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="nav__bag">
            <path
              d="M5 6.5 h10 l-1 10.5 H6 Z M7.4 6.5 V5 a2.6 2.6 0 0 1 5.2 0 v1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          See cart
          {cartCount > 0 && <span className="nav__badge">{cartCount}</span>}
        </button>
      </div>
    </header>
  );
}

const MARQUEE = ['Coffee', 'Beans', 'Brewing', 'Drinkware', 'Supplies', 'Roasted Daily'];

/** The brown band. Two identical runs slide as one, so the loop has no visible seam. */
export function Marquee(): React.JSX.Element {
  const run = (key: string): React.JSX.Element => (
    <div className="marquee__run" key={key} aria-hidden={key === 'b'}>
      {MARQUEE.map((word) => (
        <span key={word}>
          {word}
          <i aria-hidden="true">•</i>
        </span>
      ))}
    </div>
  );
  return (
    <div className="marquee">
      <div className="marquee__track">
        {run('a')}
        {run('b')}
      </div>
    </div>
  );
}

const VISIT: [string, string][] = [
  ['pin', 'Jl. Boulevard Ahmad Yani, Bekasi, West Java'],
  ['clock', 'Mon – Sun · 08:00 AM – 10:00 PM'],
  ['mail', 'hello@sentinelcoffee.test · +62 812-3456-7890'],
];

function VisitIcon({ kind }: { kind: string }): React.JSX.Element {
  const d =
    kind === 'pin'
      ? 'M8 14.5 S13.5 9.8 13.5 6.4 A5.5 5.5 0 0 0 2.5 6.4 C2.5 9.8 8 14.5 8 14.5 Z M8 4.6 a1.9 1.9 0 1 0 0 3.8 a1.9 1.9 0 0 0 0-3.8 Z'
      : kind === 'clock'
        ? 'M8 1.6 a6.4 6.4 0 1 0 0 12.8 A6.4 6.4 0 0 0 8 1.6 Z M8 4.6 V8 l2.4 1.6'
        : 'M2 4 h12 v8 H2 Z M2 4.4 L8 9 l6-4.6';
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="foot" id="visit">
      <div className="foot__inner">
        <div className="foot__text">
          <a className="brand brand--light" href="#top">
            <BrandMark />
            Sentinel Coffee
          </a>
          <h2>
            Your Next Cup
            <br />
            Awaits.
          </h2>
          <p className="foot__tag">Stop by for the brew, stay for the good vibes.</p>
          <ul className="foot__list">
            {VISIT.map(([kind, text]) => (
              <li key={text}>
                <VisitIcon kind={kind} />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <CupScene className="foot__cup" />
      </div>
      <div className="foot__bar">
        <p>A demo storefront for Sentinel · no real orders, no real charges.</p>
      </div>
    </footer>
  );
}
