import { CraftScene } from './SceneArt.js';

/** A loose coffee bean, floated over the scene as the reference does at two corners. */
function Bean({ className }: { className: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 60 60" aria-hidden="true">
      <defs>
        <linearGradient id="bean-grad" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#7A4A28" />
          <stop offset="100%" stopColor="#331A0B" />
        </linearGradient>
      </defs>
      <g transform="rotate(-24 30 30)">
        <ellipse cx="30" cy="30" rx="26" ry="19" fill="url(#bean-grad)" />
        <path
          d="M30 12 C38 21, 38 39, 30 48"
          fill="none"
          stroke="rgba(0,0,0,0.6)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <ellipse
          cx="22"
          cy="22"
          rx="7"
          ry="4"
          fill="rgba(255,255,255,0.16)"
          transform="rotate(-30 22 22)"
        />
      </g>
    </svg>
  );
}

export function Story(): React.JSX.Element {
  return (
    <section className="story" id="craft">
      <span className="story__ghost" aria-hidden="true">
        SENTINEL COFFEE
      </span>

      <div className="story__head">
        <p className="eyebrow eyebrow--center">
          <span aria-hidden="true" />
          The craft
          <span aria-hidden="true" />
        </p>
        <h2>Our Story Process</h2>
      </div>

      <div className="story__inner">
        <div className="story__figure">
          <Bean className="story__bean story__bean--tl" />
          <CraftScene className="story__scene" />
          <Bean className="story__bean story__bean--br" />
        </div>

        <div className="story__text">
          <h3>
            Relentless Pursuit
            <br />
            of the Perfect Cup.
          </h3>
          <p>
            Coffee is a craft before it is a drink. The bean is chosen at the farm, roasted to open
            its character rather than hide it, and brewed with enough precision to honour where it
            came from.
          </p>
          <p>
            The same care runs under this shop. Prices are set server-side, the card never touches
            this page, and every attempt — paid, failed or abandoned — is recorded honestly.
          </p>
          <a className="btn" href="#shop">
            Explore our craft
          </a>
        </div>
      </div>
    </section>
  );
}
