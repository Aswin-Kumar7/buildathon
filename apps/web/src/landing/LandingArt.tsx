/**
 * The technical line-art behind the tier and pipeline cards, plus the small brand marks in the
 * "built on" row.
 *
 * Inline SVG rather than image assets: every one of these has to inherit the card's stroke colour,
 * stay crisp at any width, and animate with the card as it scrolls in. Six flat diagrams and six
 * marks would cost more as an asset pipeline than they do as paths.
 */

/** Isometric projection used by the slab diagrams — a 45° rotation squashed to half height. */
const iso = (x: number, y: number) => `translate(${x} ${y}) scale(1 0.5) rotate(45)`;

/** A faint diamond lattice, the ground every isometric diagram sits on. */
function Lattice(): React.JSX.Element {
  return (
    <>
      <defs>
        <pattern id="lpLattice" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M13 0 L26 13 L13 26 L0 13 Z" className="lp-art__lattice" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="320" height="192" fill="url(#lpLattice)" stroke="none" />
    </>
  );
}

/* ── tier diagrams ──────────────────────────────────────────────────────────────────────────── */

/** Rules: a fixed lattice with one deterministic path lit through it. */
export function ArtRules(): React.JSX.Element {
  return (
    <svg viewBox="0 0 320 192" className="lp-art" role="img" aria-label="Deterministic rules">
      <Lattice />
      <g transform={iso(160, 96)}>
        <rect x="-58" y="-58" width="116" height="116" rx="4" className="lp-art__slab" />
        <path d="M-58 -19 H58 M-58 19 H58 M-19 -58 V58 M19 -58 V58" className="lp-art__grid" />
        <rect x="-25" y="-25" width="50" height="50" rx="3" className="lp-art__chip" />
        <path d="M-58 39 H-39 V0 H0 V-39 H39 V-58" className="lp-art__trace" />
      </g>
      <circle cx="66" cy="120" r="3.5" className="lp-art__node" />
      <circle cx="254" cy="72" r="3.5" className="lp-art__node" />
    </svg>
  );
}

/** Model: stacked planes — features, weights, one calibrated estimate on top. */
export function ArtModel(): React.JSX.Element {
  const layers = [34, 0, -34];
  return (
    <svg viewBox="0 0 320 192" className="lp-art" role="img" aria-label="Calibrated model">
      <Lattice />
      {layers.map((dy, i) => (
        <g key={dy} transform={iso(160, 116 + dy)}>
          <rect
            x="-52"
            y="-52"
            width="104"
            height="104"
            rx="4"
            className={i === 2 ? 'lp-art__chip' : 'lp-art__slab'}
          />
          {i !== 2 && <path d="M-52 0 H52 M0 -52 V52" className="lp-art__grid" />}
        </g>
      ))}
      <path d="M160 148 V128 M160 114 V94" className="lp-art__trace" />
      <circle cx="160" cy="152" r="3.5" className="lp-art__node" />
    </svg>
  );
}

/** Policy: a gate a decision passes through, with the release path back out. */
export function ArtPolicy(): React.JSX.Element {
  return (
    <svg viewBox="0 0 320 192" className="lp-art" role="img" aria-label="Policy and approval">
      <Lattice />
      <g transform={iso(160, 96)}>
        <rect x="-60" y="-60" width="120" height="120" rx="5" className="lp-art__slab" />
        <rect x="-30" y="-30" width="60" height="60" rx="4" className="lp-art__chip" />
      </g>
      <path d="M46 96 H104" className="lp-art__trace" />
      <path d="M216 96 H274" className="lp-art__trace" />
      <path d="M262 86 L274 96 L262 106" className="lp-art__trace" />
      <path d="M104 150 Q160 176 216 150" className="lp-art__dash" />
      <circle cx="46" cy="96" r="3.5" className="lp-art__node" />
      <circle cx="274" cy="96" r="3.5" className="lp-art__node" />
    </svg>
  );
}

/* ── pipeline diagrams ──────────────────────────────────────────────────────────────────────── */

/** Correlate: three ports feeding traces into one board — the reference's circuit-board figure. */
/**
 * One correlation source — a small slab carrying a few attempts.
 *
 * The rules on it are the point: a source is never a single event, it is several that only mean
 * something once they are read together.
 */
function Source({ x, y }: { x: number; y: number }): React.JSX.Element {
  return (
    <g transform={iso(x, y)}>
      <rect x="-16" y="-16" width="32" height="32" rx="2.5" className="lp-art__slab" />
      <path d="M-16 -5.5 H16 M-16 5.5 H16" className="lp-art__grid" />
    </g>
  );
}

/**
 * Correlate: three separate sources — session, device, network — joined into one case.
 *
 * The earlier drawing was three unlabelled ports wired to a slab, which read as "some things
 * connect to a thing". This one carries the actual claim: each source arrives holding several
 * attempts, the dashed runs converge rather than merely touch, and what they land on is a single
 * lit case rather than another anonymous box.
 */
export function ArtCorrelate(): React.JSX.Element {
  // Placed to meet the central diamond's left, upper-left and right faces respectively.
  const sources = [
    { x: 44, y: 52 },
    { x: 40, y: 142 },
    { x: 276, y: 72 },
  ];
  return (
    <svg
      viewBox="0 0 320 192"
      className="lp-art"
      role="img"
      aria-label="Session, device and network signals converging into one case"
    >
      <Lattice />
      {sources.map((s) => (
        <Source key={`${s.x}-${s.y}`} x={s.x} y={s.y} />
      ))}

      {/* The joins. Straight runs, as everywhere else in this set. */}
      <path d="M66 58 L127 86 M62 147 L129 114 M254 79 L207 100" className="lp-art__dash" />

      {/* The case they land on. */}
      <g transform={iso(162, 102)}>
        <rect x="-46" y="-36" width="92" height="72" rx="5" className="lp-art__slab" />
        <path d="M-46 -14 H-22 V14 H10 M46 6 H24 V-20 H-4" className="lp-art__trace" />
        <rect x="-13" y="-11" width="26" height="22" rx="3" className="lp-art__chip" />
      </g>

      {/* Where each run meets the case — the moment three things become one. */}
      <circle cx="127" cy="86" r="2.6" className="lp-art__node" />
      <circle cx="129" cy="114" r="2.6" className="lp-art__node" />
      <circle cx="207" cy="100" r="2.6" className="lp-art__node" />
    </svg>
  );
}

/** Validate: a reliability curve against the diagonal it is measured for. */
export function ArtValidate(): React.JSX.Element {
  return (
    <svg viewBox="0 0 320 192" className="lp-art" role="img" aria-label="Model validation">
      <Lattice />
      <rect x="84" y="34" width="152" height="124" rx="4" className="lp-art__slab" />
      <path d="M84 96 H236 M160 34 V158" className="lp-art__grid" />
      <path d="M84 158 L236 34" className="lp-art__dash" />
      <path d="M84 158 C124 154 138 120 160 96 C182 72 200 44 236 34" className="lp-art__trace" />
      <circle cx="122" cy="140" r="3" className="lp-art__node" />
      <circle cx="160" cy="96" r="3" className="lp-art__node" />
      <circle cx="204" cy="54" r="3" className="lp-art__node" />
    </svg>
  );
}

/** Contain: a decision passing a switch, with the reversal path drawn back underneath. */
export function ArtContain(): React.JSX.Element {
  return (
    <svg viewBox="0 0 320 192" className="lp-art" role="img" aria-label="Reversible containment">
      <Lattice />
      <path d="M40 78 H128" className="lp-art__trace" />
      <path d="M192 78 H280" className="lp-art__grid" />
      <rect x="128" y="58" width="64" height="40" rx="20" className="lp-art__slab" />
      <circle cx="148" cy="78" r="12" className="lp-art__chip" />
      <path d="M40 78 L40 130 Q160 168 280 130 L280 78" className="lp-art__dash" />
      <path d="M50 88 L40 78 L30 88" className="lp-art__trace" />
      <circle cx="280" cy="78" r="3.5" className="lp-art__node" />
    </svg>
  );
}

/* ── brand marks ────────────────────────────────────────────────────────────────────────────── */

export type BrandName = 'Razorpay' | 'NestJS' | 'React' | 'PostgreSQL' | 'Groq' | 'Azure';

const MARKS: Record<BrandName, React.JSX.Element> = {
  Razorpay: (
    <svg viewBox="0 0 24 24" className="lp-mark" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <path d="M2.8 21.5h6.4l3.1-11.5-8.1 5.9z" />
        <path d="M11.2 9.5L18.6 2.5h3.4l-7.2 19h-3.8l2.5-11z" />
      </g>
    </svg>
  ),
  NestJS: (
    <svg viewBox="0 0 32 32" className="lp-mark" aria-hidden="true" focusable="false">
      <path
        d="M18.487,2a1.781,1.781,0,0,0-.564.1c1.615,1.062-.29,2.6.6,3.9A2.235,2.235,0,0,1,19.6,3.765c.285-.237.468-.322.407-.714C19.908,2.409,19.052,2,18.487,2Zm2.3.414c-.223,1.123-.5,1.164-1.323,1.887a1.821,1.821,0,0,0-.527,2.191c-3.4-1.32-7.758-2.118-10.953.166-1.149.821-1.85,2-3.267,2.481-.916.314-1.816.221-2.39,1.129A1.413,1.413,0,0,0,2.383,12.1c.171.175.5.287.636.465.079.1.077.2.152.333a2.6,2.6,0,0,0,.564.828c.147.121.652.239.738.368.108.161-.172.8.063.9.158.073.621-.744.666-.816-.092.643-.213,1.784.51.834.343-.451.364-.6.941-.7a8.2,8.2,0,0,1,1.117-.116,8.362,8.362,0,0,1,8.622,7.622c-.108-.5-.761-1.3-1.369-1.11-.259.08-.355.527-.525.786a3.773,3.773,0,0,1-.785.868,4.687,4.687,0,0,0-.072-1.452c-.182.748-.547,1.989-1.466,1.788a1.652,1.652,0,0,1-1.328-1.142c-.119-.76.684-1.651-.607-1.714-2.59-.127-1.991,3.682-.462,4.675a3.272,3.272,0,0,0-1.015.283,6.893,6.893,0,0,0,10.276-4.922,7.058,7.058,0,0,1-.015,3.085,7.213,7.213,0,0,1-.554,1.559,6.781,6.781,0,0,1-1.3,1.81c-.314.311-.89.624-1.088.941a13.409,13.409,0,0,0,3.52-.968A11.638,11.638,0,0,1,15.1,30a11.589,11.589,0,0,0,9.3-5.909,11.657,11.657,0,0,1-1.945,4.668,11.531,11.531,0,0,0,4.975-7.783,11.622,11.622,0,0,1,.209,3.5A12.418,12.418,0,0,0,29.528,13.91a15.755,15.755,0,0,0-1.689-3.962A14.838,14.838,0,0,0,26.9,8.554c-.133-.173-.844-.806-.844-1q-.009.029-.015,0c0,3.248-3.5,5.333-6.431,4.463A5,5,0,0,0,24.156,7.85,5,5,0,0,0,20.787,2.414Z"
        fill="currentColor"
      />
    </svg>
  ),
  React: (
    <svg viewBox="0 0 24 24" className="lp-mark" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <ellipse cx="12" cy="12" rx="9.5" ry="3.8" />
        <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" />
      </g>
    </svg>
  ),
  PostgreSQL: (
    <svg viewBox="0 0 24 24" className="lp-mark" aria-hidden="true" focusable="false">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="5" rx="8.5" ry="3" />
        <path d="M3.5 5v6c0 1.65 3.8 3 8.5 3s8.5-1.35 8.5-3V5" />
        <path d="M3.5 11v6c0 1.65 3.8 3 8.5 3s8.5-1.35 8.5-3v-6" />
      </g>
    </svg>
  ),
  Groq: (
    <svg viewBox="0 0 24 24" className="lp-mark" aria-hidden="true" focusable="false">
      <path d="M14 2L4 13h6l-2 9 10-11h-6l2-9z" fill="currentColor" />
    </svg>
  ),
  Azure: (
    <svg viewBox="0 0 24 24" className="lp-mark" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <path d="M13.05 2.5L21.5 19.5H13.8L13.05 2.5Z" opacity="0.6" />
        <path d="M2.5 19.5L10.2 2.5H14.4L7.4 14.5L2.5 19.5Z" />
      </g>
    </svg>
  ),
};

/** A small SVG mark for the stack row. */
export function BrandMark({ name }: { name: BrandName }): React.JSX.Element {
  return MARKS[name];
}

/* ── social marks ───────────────────────────────────────────────────────────────────────────── */

export function IconGitHub(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="lp-social__icon" aria-hidden="true" focusable="false">
      <path
        d="M12 1.8a10.2 10.2 0 0 0-3.23 19.88c.51.1.7-.22.7-.49v-1.9c-2.84.62-3.44-1.2-3.44-1.2-.47-1.18-1.14-1.5-1.14-1.5-.93-.63.07-.62.07-.62 1.03.07 1.57 1.06 1.57 1.06.91 1.57 2.4 1.12 2.99.86.09-.66.36-1.12.65-1.38-2.27-.26-4.65-1.14-4.65-5.06 0-1.12.4-2.03 1.05-2.75-.1-.26-.46-1.3.1-2.7 0 0 .86-.28 2.8 1.05a9.7 9.7 0 0 1 5.1 0c1.94-1.33 2.8-1.05 2.8-1.05.56 1.4.2 2.44.1 2.7.65.72 1.05 1.63 1.05 2.75 0 3.93-2.39 4.8-4.66 5.05.37.32.7.94.7 1.9v2.82c0 .27.18.6.7.49A10.2 10.2 0 0 0 12 1.8Z"
        strokeWidth="0"
      />
    </svg>
  );
}

export function IconLinkedIn(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="lp-social__icon" aria-hidden="true" focusable="false">
      <path
        d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05a3.75 3.75 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z"
        strokeWidth="0"
      />
    </svg>
  );
}
