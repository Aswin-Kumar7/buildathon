/**
 * Drawn product artwork.
 *
 * The shop has a real catalogue but no photography, and a stock photo of someone else's kettle
 * would be a worse lie than an honest drawing. These are built the way the products would be
 * photographed for a catalogue: the object in full colour on a warm paper ground, lit from the
 * upper left, sitting on its own contact shadow — not an outline floating on a gradient.
 */

interface Palette {
  paper: string;
  wash: string;
}

const PAPER: Palette[] = [
  { paper: '#F5EFE6', wash: '#E9DFD1' },
  { paper: '#F2EDE7', wash: '#E3D9CC' },
  { paper: '#F6EEE4', wash: '#EADDCB' },
  { paper: '#F1EEE9', wash: '#E2DAD0' },
];

/** The paper ground, its soft vignette, and the contact shadow every object stands on. */
function Ground({ id, tone }: { id: string; tone: Palette }): React.JSX.Element {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-wash`} cx="0.42" cy="0.34" r="0.78">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor={tone.wash} />
        </radialGradient>
        <radialGradient id={`${id}-shadow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(74,45,24,0.30)" />
          <stop offset="100%" stopColor="rgba(74,45,24,0)" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill={tone.paper} />
      <rect width="200" height="200" fill={`url(#${id}-wash)`} />
      <ellipse cx="100" cy="168" rx="60" ry="13" fill={`url(#${id}-shadow)`} />
    </>
  );
}

/** Shared metal and enamel fills, so four objects read as one product family. */
function Materials(): React.JSX.Element {
  return (
    <defs>
      <linearGradient id="mat-dark" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#4B4A48" />
        <stop offset="34%" stopColor="#22211F" />
        <stop offset="78%" stopColor="#151413" />
        <stop offset="100%" stopColor="#3A3937" />
      </linearGradient>
      <linearGradient id="mat-steel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#C9C6C1" />
        <stop offset="28%" stopColor="#F2F0EC" />
        <stop offset="62%" stopColor="#A9A5A0" />
        <stop offset="100%" stopColor="#D6D3CE" />
      </linearGradient>
      <linearGradient id="mat-kraft" x1="0" y1="0" x2="1" y2="0.3">
        <stop offset="0%" stopColor="#D8B98C" />
        <stop offset="55%" stopColor="#C09A69" />
        <stop offset="100%" stopColor="#A67F4F" />
      </linearGradient>
      <linearGradient id="mat-glass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(255,255,255,0.75)" />
        <stop offset="45%" stopColor="rgba(214,206,196,0.42)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0.6)" />
      </linearGradient>
    </defs>
  );
}

/** A gooseneck pour-over kettle: matte body, long swan neck, walnut handle. */
function Kettle(): React.JSX.Element {
  return (
    <>
      <Ground id="g-kettle" tone={PAPER[0]!} />
      <Materials />
      <path
        d="M62 104 a38 38 0 0 1 76 0 v46 a14 14 0 0 1-14 14 H76 a14 14 0 0 1-14-14 Z"
        fill="url(#mat-dark)"
      />
      <path
        d="M70 104 a30 30 0 0 1 20-28 c-16 6-24 18-24 30 v44 h4 Z"
        fill="rgba(255,255,255,0.13)"
      />
      <path
        d="M136 100 c26-2 34-22 26-38 -5-10-17-13-24-6"
        fill="none"
        stroke="url(#mat-dark)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        d="M136 100 c26-2 34-22 26-38"
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M64 92 c-16 3-24-14-10-23 l12-7"
        fill="none"
        stroke="#6B4326"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <ellipse cx="100" cy="70" rx="21" ry="6" fill="#2A2927" />
      <rect x="94" y="56" width="12" height="12" rx="4" fill="#6B4326" />
      <ellipse cx="88" cy="126" rx="9" ry="17" fill="rgba(255,255,255,0.09)" />
    </>
  );
}

/** A hand grinder: dark cap, glass catch jar, steel crank. */
function Grinder(): React.JSX.Element {
  return (
    <>
      <Ground id="g-grinder" tone={PAPER[1]!} />
      <Materials />
      <path
        d="M76 108 h48 v44 a12 12 0 0 1-12 12 H88 a12 12 0 0 1-12-12 Z"
        fill="url(#mat-glass)"
      />
      <path
        d="M76 108 h48 v44 a12 12 0 0 1-12 12 H88 a12 12 0 0 1-12-12 Z"
        fill="none"
        stroke="#B8B2A9"
        strokeWidth="2"
      />
      <path
        d="M82 138 h36 v14 a10 10 0 0 1-10 10 H92 a10 10 0 0 1-10-10 Z"
        fill="#6B4326"
        opacity="0.8"
      />
      <rect x="70" y="86" width="60" height="24" rx="6" fill="url(#mat-dark)" />
      <rect x="74" y="90" width="52" height="5" rx="2.5" fill="rgba(255,255,255,0.16)" />
      <rect x="88" y="70" width="24" height="16" rx="4" fill="#2A2927" />
      <path
        d="M100 70 V52 h26 a9 9 0 0 1 0 18"
        fill="none"
        stroke="url(#mat-steel)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="128" cy="61" r="7" fill="#6B4326" />
      <circle cx="100" cy="50" r="4.5" fill="#3A3937" />
    </>
  );
}

/** An insulated tumbler: brushed steel body, dark lid, sip slot. */
function Mug(): React.JSX.Element {
  return (
    <>
      <Ground id="g-mug" tone={PAPER[2]!} />
      <Materials />
      <path
        d="M80 78 h40 l-6 76 a12 12 0 0 1-12 11 H98 a12 12 0 0 1-12-11 Z"
        fill="url(#mat-steel)"
      />
      <path d="M86 78 l-5 76 a12 12 0 0 0 6 10 c-6-2-8-6-8-11 Z" fill="rgba(255,255,255,0.55)" />
      <rect x="82" y="104" width="36" height="15" fill="#6B4326" opacity="0.85" />
      <path d="M74 66 h52 a5 5 0 0 1 0 14 H74 a5 5 0 0 1 0-14 Z" fill="url(#mat-dark)" />
      <path d="M92 66 v-9 a8 8 0 0 1 16 0 v9" fill="#2A2927" />
      <rect x="98" y="52" width="18" height="5" rx="2.5" fill="#4B4A48" />
      <ellipse cx="100" cy="163" rx="18" ry="4" fill="rgba(0,0,0,0.18)" />
    </>
  );
}

/** A fanned stack of unbleached cone filters. */
function Filters(): React.JSX.Element {
  return (
    <>
      <Ground id="g-filter" tone={PAPER[3]!} />
      <Materials />
      <g transform="rotate(-7 100 120)">
        <path d="M56 76 h88 l-36 82 a8 8 0 0 1-16 0 Z" fill="#B08B5C" />
      </g>
      <g transform="rotate(-3 100 120)">
        <path d="M58 72 h88 l-36 82 a8 8 0 0 1-16 0 Z" fill="#C49A67" />
      </g>
      <path d="M60 68 h88 l-36 82 a8 8 0 0 1-16 0 Z" fill="url(#mat-kraft)" />
      <path d="M60 68 h88 l-6 14 H66 Z" fill="rgba(255,255,255,0.28)" />
      <g stroke="rgba(90,60,30,0.35)" strokeWidth="1.6" fill="none">
        <path d="M70 92 h68" />
        <path d="M78 112 h52" />
        <path d="M86 132 h36" />
      </g>
      <path d="M104 68 L92 150" stroke="rgba(255,255,255,0.30)" strokeWidth="3" fill="none" />
    </>
  );
}

const ART: Record<string, () => React.JSX.Element> = {
  'kettle-01': Kettle,
  'grinder-01': Grinder,
  'mug-01': Mug,
  'filter-02': Filters,
};

/** A roast bag, for a SKU the catalogue gains later that has no drawing of its own yet. */
function Fallback(): React.JSX.Element {
  return (
    <>
      <Ground id="g-fallback" tone={PAPER[0]!} />
      <Materials />
      <path d="M68 74 h64 v76 a10 10 0 0 1-10 10 H78 a10 10 0 0 1-10-10 Z" fill="url(#mat-dark)" />
      <path d="M68 74 l10-14 h44 l10 14 Z" fill="#2A2927" />
      <rect x="68" y="74" width="9" height="86" fill="rgba(255,255,255,0.12)" />
      <rect x="84" y="104" width="32" height="4" rx="2" fill="rgba(255,255,255,0.3)" />
    </>
  );
}

export function ProductArt({
  sku,
  className,
}: {
  sku: string;
  className?: string;
}): React.JSX.Element {
  const Draw = ART[sku] ?? Fallback;
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <Draw />
    </svg>
  );
}
