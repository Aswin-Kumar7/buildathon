/**
 * The three large illustrations: the hero composition, the craft scene, and the footer cup.
 *
 * Same reasoning as the product art — drawn rather than photographed, because the shop is a demo
 * and borrowed photography would misrepresent it. They are built to sit at large sizes, so they
 * carry more tonal work than the product tiles: real gradients, a bean field, condensation.
 */

/**
 * A scattered field of coffee beans, used as the dark panel behind the hero bag.
 *
 * Laid out across the panel's own box rather than the whole canvas — the first version used a
 * lattice starting at the canvas origin, so the clip path cut away all but the leftmost column
 * and the panel read as empty.
 */
function BeanField({
  id,
  x0,
  y0,
  x1,
  y1,
}: {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}): React.JSX.Element {
  const beans: { x: number; y: number; r: number; a: number }[] = [];
  const cols = 8;
  const rows = 7;
  const stepX = (x1 - x0) / cols;
  const stepY = (y1 - y0) / rows;
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      // A deterministic offset, not a random one — random would re-scatter on every render.
      const jitter = ((row * 7 + col * 13) % 11) - 5;
      beans.push({
        x: x0 + col * stepX + jitter * 2.2 + (row % 2) * stepX * 0.5,
        y: y0 + row * stepY + (((col * 5) % 7) - 3) * 2,
        r: 17 + ((row + col) % 3) * 2.5,
        a: ((row * 31 + col * 17) % 180) - 90,
      });
    }
  }
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-bean`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#7A4A2A" />
          <stop offset="100%" stopColor="#2C1508" />
        </linearGradient>
      </defs>
      {beans.map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${b.a})`}>
          <ellipse rx={b.r} ry={b.r * 0.72} fill={`url(#${id}-bean)`} />
          <ellipse
            rx={b.r * 0.55}
            ry={b.r * 0.3}
            cx={-b.r * 0.22}
            cy={-b.r * 0.28}
            fill="rgba(255,255,255,0.10)"
          />
          <path
            d={`M 0 ${-b.r * 0.68} C ${b.r * 0.32} ${-b.r * 0.2}, ${b.r * 0.32} ${b.r * 0.2}, 0 ${b.r * 0.68}`}
            fill="none"
            stroke="rgba(0,0,0,0.62)"
            strokeWidth="2.2"
          />
        </g>
      ))}
    </g>
  );
}

/** A tall iced latte: layered milk and espresso, ice, straw, condensation. */
function IcedLatte({ x, y, scale }: { x: number; y: number; scale: number }): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <defs>
        <linearGradient id="latte-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#C98A55" />
          <stop offset="38%" stopColor="#E8C49A" />
          <stop offset="72%" stopColor="#B87642" />
          <stop offset="100%" stopColor="#8B5228" />
        </linearGradient>
        <linearGradient id="latte-foam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F3E3D0" />
          <stop offset="50%" stopColor="#FFF8EF" />
          <stop offset="100%" stopColor="#E4CDB2" />
        </linearGradient>
        <clipPath id="latte-clip">
          <path d="M8 34 h124 l-13 168 a16 16 0 0 1-16 15 H37 a16 16 0 0 1-16-15 Z" />
        </clipPath>
      </defs>

      <path
        d="M8 34 h124 l-13 168 a16 16 0 0 1-16 15 H37 a16 16 0 0 1-16-15 Z"
        fill="url(#latte-body)"
      />
      <g clipPath="url(#latte-clip)">
        <rect x="0" y="34" width="140" height="58" fill="url(#latte-foam)" />
        <rect x="0" y="92" width="140" height="16" fill="rgba(255,255,255,0.35)" />
        <rect x="0" y="150" width="140" height="70" fill="rgba(61,30,12,0.34)" />
        {[
          [26, 44, 30, 26],
          [62, 40, 34, 28],
          [96, 52, 26, 24],
          [44, 74, 28, 22],
        ].map(([bx, by, bw, bh], i) => (
          <rect
            key={i}
            x={bx}
            y={by}
            width={bw}
            height={bh}
            rx="6"
            fill="rgba(255,255,255,0.5)"
            transform={`rotate(${i * 17 - 20} ${bx! + bw! / 2} ${by! + bh! / 2})`}
          />
        ))}
        <rect x="14" y="34" width="12" height="183" fill="rgba(255,255,255,0.28)" />
      </g>
      <path
        d="M8 34 h124 l-13 168 a16 16 0 0 1-16 15 H37 a16 16 0 0 1-16-15 Z"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="3"
      />
      <ellipse cx="70" cy="34" rx="62" ry="11" fill="#FFF8EF" />
      <ellipse
        cx="70"
        cy="34"
        rx="62"
        ry="11"
        fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="2.5"
      />
      <g transform="rotate(9 70 34)">
        <rect x="74" y="-42" width="11" height="86" rx="5" fill="#3D2415" />
        <rect x="76" y="-42" width="3.5" height="86" fill="rgba(255,255,255,0.28)" />
      </g>
      <g fill="rgba(255,255,255,0.5)">
        <circle cx="30" cy="120" r="3" />
        <circle cx="112" cy="98" r="2.4" />
        <circle cx="104" cy="160" r="3.4" />
        <circle cx="24" cy="176" r="2.2" />
      </g>
    </g>
  );
}

/** The hero: a dark bean panel, a roast bag standing on it, and the drink in front. */
export function HeroScene({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 620 470" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="bag-face" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="#2B2B2D" />
          <stop offset="52%" stopColor="#131315" />
          <stop offset="100%" stopColor="#39393C" />
        </linearGradient>
        <clipPath id="panel-clip">
          <rect x="196" y="0" width="424" height="330" rx="4" />
        </clipPath>
      </defs>

      <g clipPath="url(#panel-clip)">
        <rect x="196" y="0" width="424" height="330" fill="#2A1509" />
        <BeanField id="hero" x0={188} y0={-6} x1={628} y1={338} />
      </g>

      <g transform="translate(352 92)">
        <path
          d="M0 44 h206 v250 a10 10 0 0 1-10 10 H10 a10 10 0 0 1-10-10 Z"
          fill="url(#bag-face)"
        />
        <path d="M0 44 l22-30 h162 l22 30 Z" fill="#232326" />
        <path d="M22 14 h162 v10 H22 Z" fill="#3A3A3E" />
        <rect x="0" y="44" width="18" height="260" fill="rgba(255,255,255,0.07)" />
        <text
          x="103"
          y="150"
          textAnchor="middle"
          fill="#F2E7DA"
          fontSize="26"
          fontFamily="Georgia, serif"
          fontStyle="italic"
        >
          Sentinel
        </text>
        <path d="M52 168 h102" stroke="rgba(242,231,218,0.4)" strokeWidth="1.6" />
        <text
          x="103"
          y="192"
          textAnchor="middle"
          fill="rgba(242,231,218,0.72)"
          fontSize="11"
          letterSpacing="2.6"
          fontFamily="Helvetica, Arial, sans-serif"
        >
          HOME BREW KIT
        </text>
        <rect x="66" y="248" width="74" height="26" rx="13" fill="rgba(242,231,218,0.14)" />
        <text
          x="103"
          y="265"
          textAnchor="middle"
          fill="rgba(242,231,218,0.82)"
          fontSize="10"
          letterSpacing="1.8"
          fontFamily="Helvetica, Arial, sans-serif"
        >
          TEST MODE
        </text>
      </g>

      <IcedLatte x={96} y={150} scale={1.28} />
    </svg>
  );
}

/** The craft scene: an espresso bar, a barista silhouette, steam. */
export function CraftScene({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 520 380" role="img" aria-hidden="true">
      <defs>
        <linearGradient id="craft-room" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#C7A483" />
          <stop offset="100%" stopColor="#7C5535" />
        </linearGradient>
        <linearGradient id="craft-machine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#40403F" />
          <stop offset="100%" stopColor="#1B1B1A" />
        </linearGradient>
      </defs>
      <rect width="520" height="380" fill="url(#craft-room)" />
      <rect x="0" y="248" width="520" height="132" fill="#5E3D24" />
      <rect x="0" y="242" width="520" height="10" fill="#8A6039" />

      <g opacity="0.5" fill="#6B4A2E">
        <rect x="34" y="42" width="150" height="8" rx="4" />
        <rect x="34" y="104" width="150" height="8" rx="4" />
        <rect x="52" y="56" width="26" height="44" rx="4" />
        <rect x="88" y="60" width="26" height="40" rx="4" />
        <rect x="124" y="54" width="26" height="46" rx="4" />
      </g>

      <g transform="translate(268 96)">
        <rect x="0" y="30" width="196" height="118" rx="10" fill="url(#craft-machine)" />
        <rect x="16" y="0" width="164" height="34" rx="8" fill="#2C2C2B" />
        <rect x="26" y="52" width="52" height="30" rx="5" fill="#0F0F0F" />
        <circle cx="132" cy="66" r="13" fill="#0F0F0F" />
        <circle cx="132" cy="66" r="5" fill="#C6813F" />
        <rect x="34" y="98" width="36" height="10" rx="5" fill="#8C8C8B" />
        <rect x="44" y="108" width="16" height="22" rx="4" fill="#6E6E6D" />
        <rect x="112" y="98" width="60" height="8" rx="4" fill="#6E6E6D" />
      </g>

      <g fill="#3A241A">
        <path d="M150 250 c0-46 22-74 54-74 s54 28 54 74 Z" />
        <circle cx="204" cy="150" r="30" />
        <path
          d="M232 196 c26 6 40 22 44 40"
          fill="none"
          stroke="#3A241A"
          strokeWidth="13"
          strokeLinecap="round"
        />
      </g>
      <path d="M204 128 a30 30 0 0 1 30 22 h-60 a30 30 0 0 1 30-22 Z" fill="#28160E" />

      <g stroke="rgba(255,255,255,0.55)" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M300 96 c-10-14 8-22 -2-38" />
        <path d="M320 92 c-9-13 7-20 -2-34" />
      </g>

      <g fill="#F0E2D2">
        <rect x="66" y="212" width="30" height="32" rx="4" />
        <rect x="104" y="216" width="26" height="28" rx="4" />
      </g>
    </svg>
  );
}

/** The footer cup: the same drink as the hero, cropped tall. */
export function CupScene({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 200 300" role="img" aria-hidden="true">
      <IcedLatte x={26} y={34} scale={1.12} />
    </svg>
  );
}
