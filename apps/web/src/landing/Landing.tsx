import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMeta, type MetaState } from './useMeta.js';
import { StorefrontLink } from '../components/StorefrontLink.js';
import razorpayLogo from '../assets/white.png';
import {
  ArtRules,
  ArtModel,
  ArtPolicy,
  ArtCorrelate,
  ArtValidate,
  ArtContain,
  BrandMark,
  IconGitHub,
  IconLinkedIn,
  type BrandName,
} from './LandingArt.js';
import './Landing.css';

const NAV = [
  { label: 'Product', href: '#product' },
  { label: 'Accuracy', href: '#detection' },
  { label: 'How it works', href: '#evidence' },
  { label: 'Pipeline', href: '#pipeline' },
  { label: 'FAQ', href: '#faq' },
];

/** The stack the product actually runs on — a truthful stand-in for a customer logo wall. */
const STACK: BrandName[] = ['Razorpay', 'NestJS', 'React', 'PostgreSQL', 'Groq', 'Azure'];

const APART = [
  { n: '/01', title: 'Scores you can trust', meta: 'SAYS 90%? ABOUT 9 IN 10 ARE' },
  { n: '/02', title: 'Nothing to install', meta: 'NO CHANGES TO YOUR CHECKOUT' },
  { n: '/03', title: 'Blocks are temporary', meta: 'THEY LIFT AFTER 30 MINUTES' },
  { n: '/04', title: 'A record you can check', meta: 'EDIT IT AND IT SHOWS' },
];

const PILLARS = [
  {
    label: 'ACCURACY',
    body: 'Only ever tested on attacks it has never seen before. Random guessing scores 0.21.',
    foot: 'PR-AUC 0.991',
  },
  {
    label: 'FALSE ALARMS',
    body: 'Gateway outages, repeated retries, flash sales — eleven scenarios, 1,105 entities judged. Not one of them was ever acted against, and the whole run is regenerated on every build.',
    foot: 'ZERO IN 1,105 CHECKS',
  },
  {
    label: 'HUMAN IN THE LOOP',
    body: 'The most it can do is ask you to take a look. It cannot block anyone.',
    foot: 'NO AUTOMATIC BLOCKING',
  },
  {
    label: 'SHOWS ITS WORKING',
    body: 'Every decision keeps the evidence behind it and the rule that allowed it.',
    foot: 'CHANGE IT AND IT SHOWS',
  },
];

const STATS = [
  { value: '0.991', cap: 'PR-AUC ON UNSEEN ATTACKS' },
  { value: '97.9%', cap: 'OF ATTACKS CAUGHT' },
  { value: '0', cap: 'FALSE ALARMS IN 1,105 CHECKS' },
];

const TIERS = [
  {
    tag: '[ LAYER 01 — FIXED RULES ]',
    name: 'Rules & Evidence',
    role: '11 CHECKS, 5 EXPLANATIONS',
    art: 'rules' as const,
  },
  {
    tag: '[ LAYER 02 — LEARNED ]',
    name: 'The Risk Model',
    role: 'SCORES, NEVER BLOCKS',
    art: 'model' as const,
  },
  {
    tag: '[ LAYER 03 — YOU ]',
    name: 'Policy & Approval',
    role: 'APPROVED, TIMED, REVERSIBLE',
    art: 'policy' as const,
  },
];

const PIPELINE = [
  {
    title: 'Your webhooks leave out the useful part.',
    body: 'Razorpay sends no session, device or network. The storefront fills that in, so an attack spread across thirty sessions also shows up as one case at the network level — the layer you would actually block.',
    art: 'correlate' as const,
  },
  {
    title: 'We measured it before trusting it.',
    body: 'It ships with the test it was scored on, the settings it runs at, and the rival models it was measured against. The one we launched with scored 0.940. This one scores 0.991, so we swapped it.',
    art: 'validate' as const,
  },
  {
    title: 'Changed your mind? Release it.',
    body: 'Observe, review or contain. Containment needs your approval, expires after thirty minutes, and lifts the second you release it. Being wrong costs minutes, not customers.',
    art: 'contain' as const,
  },
];

const ACCORDION = [
  {
    title: 'See who made each payment',
    body: 'Every payment tied back to the browser session, device and network it came from.',
  },
  {
    title: 'A model that explains itself',
    body: 'Set one signal back to normal, score it again, and the difference is what that signal was worth.',
  },
  {
    title: 'Stop an attack without blocking buyers',
    body: 'You approve it. It expires on its own. Your name is on it.',
  },
];

const FAQ = [
  {
    q: 'Do I need to change my checkout?',
    a: 'No. Sentinel reads the Razorpay webhooks you already send. You can optionally add a small script to your shop that also records the browser session and device, but detection works without it.',
  },
  {
    q: 'What does it actually catch?',
    a: 'Card testing — someone running stolen cards through your checkout to find the live ones. The loud version, the slow one, the distributed one, and the ones hiding inside an outage or a flash sale.',
  },
  {
    q: 'Will it block my real customers?',
    a: 'It cannot block anyone by itself — the most the model can do is ask a person to look, and where the rules can positively name a cause, an outage or a retry storm or an ordinary busy hour, they overrule it. Across eleven scenarios and 1,105 entities judged, nothing benign was ever acted against. Worth knowing how that is achieved: on its own the model would flag about 4 in every 100 normal entities, almost all of them billers retrying their own failures. The rules catch those. That gap is the whole reason the model is not allowed to decide alone.',
  },
  {
    q: 'Why does one attack open several cases?',
    a: 'Because each one is something you could act on separately. Sentinel groups activity by browser session, by device and by network, so an attack spread across many sessions raises a case for each one and another for the network they share.',
  },
  {
    q: 'How accurate is it, honestly?',
    a: 'PR-AUC 0.991, recall 0.979, precision 0.875. Two attack shapes are measurably harder than the rest — card reuse at 37 of 42, and a loud attack hidden inside a biller’s retry schedule at 10 of 11 — and both numbers are published rather than averaged away. The labels are synthetic until your own confirmed incidents replace them.',
  },
  {
    q: 'What if the model goes down?',
    a: 'The rules carry on without it and the console tells you so — the console marks the decision as running without it. You lose the explanation, never the safety.',
  },
  {
    q: 'Is my data safe?',
    a: 'Sentinel never sees a card number. Payloads are encrypted at rest, anything that identifies a person is scrambled before it is stored, and the build fails if sensitive data ever reaches a log.',
  },
  {
    q: 'How fast is it?',
    a: 'New payment events are picked up every second and judged a second after that. Call it two seconds from payment to case.',
  },
  {
    q: 'Can I see why it decided that?',
    a: 'Which rules fired and the number each compared against. What the model scored and which signals moved it. The explanation it ruled out, and the exact policy that allowed the action.',
  },
  {
    q: 'Can I try it without real traffic?',
    a: 'Run the built-in simulator. Pick an attack, send it through the real system, and watch it get caught. Nothing leaves this system and no real card is involved.',
  },
];

type ArtKind = 'rules' | 'model' | 'policy' | 'correlate' | 'validate' | 'contain';

const ART: Record<ArtKind, () => React.JSX.Element> = {
  rules: ArtRules,
  model: ArtModel,
  policy: ArtPolicy,
  correlate: ArtCorrelate,
  validate: ArtValidate,
  contain: ArtContain,
};

function Art({ kind }: { kind: ArtKind }): React.JSX.Element {
  const Figure = ART[kind];
  return <Figure />;
}

/**
 * Marks an element `is-in` the first time it scrolls into view, so CSS can run the entrance once.
 *
 * A geometry check on a rAF-throttled scroll rather than an IntersectionObserver: the observer's
 * callback can be delayed or coalesced, and because the entrance starts at `opacity: 0` a callback
 * that never arrives leaves the card permanently invisible. Measuring the rect cannot fail that way,
 * and the first check runs on mount so anything already on screen is revealed immediately.
 */
function useReveal<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    let frame = 0;
    let done = false;
    const check = (): void => {
      if (done) return;
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9 && rect.bottom > 0) {
        done = true;
        node.classList.add('is-in');
      }
    };
    const onScroll = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };

    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return ref;
}

/** A card that lifts itself into place as it enters the viewport. */
function RevealCard({
  className,
  index,
  children,
}: {
  className: string;
  index: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = useReveal<HTMLElement>();
  return (
    <article
      ref={ref}
      className={`lp-reveal ${className}`}
      style={{ transitionDelay: `${index * 110}ms` }}
    >
      {children}
    </article>
  );
}

/** The corner ticks that sit on the grid intersections throughout the page. */
function Ticks(): React.JSX.Element {
  return (
    <>
      <span className="lp-tick lp-tick--tl" aria-hidden="true" />
      <span className="lp-tick lp-tick--tr" aria-hidden="true" />
    </>
  );
}

function BuildathonBanner(): React.JSX.Element {
  return (
    <div className="lp-banner">
      <div className="lp-banner__in">
        <span className="lp-banner__dot" aria-hidden="true" />
        <span className="lp-banner__text">
          This site is built for <strong>Razorpay Buildathon</strong> — it is not an official
          Razorpay site.{' '}
          <a
            href="https://razorpay.com/"
            target="_blank"
            rel="noreferrer"
            className="lp-banner__link"
          >
            Visit Official Razorpay Site <span className="lp-banner__arrow">→</span>
          </a>
        </span>
      </div>
    </div>
  );
}

function LandingNav(): React.JSX.Element {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let timer: number;
    const onScroll = (): void => {
      setStuck(window.scrollY > 24);
      document.body.classList.add('is-scrolling');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        document.body.classList.remove('is-scrolling');
      }, 1200);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
      document.body.classList.remove('is-scrolling');
    };
  }, []);
  return (
    <header className={stuck ? 'lp-nav is-stuck' : 'lp-nav'}>
      <div className="lp-nav__in">
        <a className="lp-brand" href="#top">
          <img src={razorpayLogo} alt="Razorpay" className="lp-brand__rzp" />
          <span className="lp-brand__div" aria-hidden="true" />
          <span className="lp-brand__name">SENTINEL</span>
        </a>
        <nav className="lp-nav__links">
          {NAV.map((item) => (
            <a key={item.label} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="lp-nav__cta">
          <StorefrontLink className="lp-nav__alt">Storefront</StorefrontLink>
          <Link to="/login" className="lp-btn lp-btn--pill">
            Open the Console
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero(): React.JSX.Element {
  return (
    <section className="lp-hero">
      <div className="lp-hero__in">
        <span className="lp-badge">
          <span className="lp-badge__dot" aria-hidden="true" />
          CARD TESTING DETECTION, BUILT FOR MERCHANTS
        </span>
        {/* States the problem before the product, because the problem is the part a merchant
            already recognises: failed payments are ordinary, which is exactly what makes an attack
            hiding among them hard to see. */}
        <h1 className="lp-hero__h1">
          Most failed payments are noise.
          <br />
          Sentinel finds the attack.
        </h1>
        <p className="lp-hero__sub">
          Related attempts are grouped into one case, with the reasons it was flagged, the cards
          involved, and a block you can apply right there.
        </p>
        <Link to="/login" className="lp-btn lp-btn--hero">
          Open the Console
          <span className="lp-btn__arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <a href="#product" className="lp-hero__scroll" aria-label="Scroll down to explore">
          <svg
            className="lp-mouse"
            viewBox="0 0 24 36"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="1.5"
              width="21"
              height="33"
              rx="10.5"
              stroke="currentColor"
              strokeWidth="2.2"
            />
            <line
              x1="12"
              y1="7"
              x2="12"
              y2="13"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="lp-mouse__wheel"
            />
          </svg>
          <span className="lp-hero__scroll-text">Scroll Down</span>
        </a>
      </div>
    </section>
  );
}

function StackBand(): React.JSX.Element {
  return (
    <section className="lp-stack">
      <div className="lp-stack__in">
        <span className="lp-stack__label">The stack it runs on</span>
        <ul className="lp-stack__logos">
          {STACK.map((name) => (
            <li key={name}>
              <BrandMark name={name} />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Results(): React.JSX.Element {
  return (
    <section className="lp-sec lp-results" id="product">
      <Ticks />
      <div className="lp-results__left">
        <h2 className="lp-h2">
          You get one case.
          <br />
          Not sixty alerts.
        </h2>
        <p className="lp-body">
          One attacker can throw hundreds of attempts at your checkout. You shouldn’t have to piece
          that together yourself, so Sentinel files it as a single case and keeps it updated while
          the attack is still going.
        </p>
      </div>
      <div className="lp-results__right">
        <span className="lp-mono lp-mono--head">WHAT SETS US APART</span>
        <ul className="lp-apart">
          {APART.map((item) => (
            <li key={item.n}>
              <span className="lp-mono lp-apart__n">{item.n}</span>
              <span className="lp-apart__title">{item.title}</span>
              <span className="lp-mono lp-apart__meta">{item.meta}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Pillars(): React.JSX.Element {
  return (
    <div className="lp-pillars">
      {PILLARS.map((p) => (
        <article key={p.label}>
          <span className="lp-mono lp-pillar__label">{p.label}</span>
          <p className="lp-pillar__body">{p.body}</p>
          <span className="lp-mono lp-pillar__foot">{p.foot}</span>
        </article>
      ))}
    </div>
  );
}

function Stats(): React.JSX.Element {
  return (
    <div className="lp-stats">
      {STATS.map((s) => (
        <div className="lp-stat" key={s.cap}>
          <strong className="lp-stat__v">{s.value}</strong>
          <span className="lp-mono lp-stat__c">{s.cap}</span>
        </div>
      ))}
    </div>
  );
}

function WhyLeaders(): React.JSX.Element {
  return (
    <section className="lp-sec lp-why" id="detection">
      <Ticks />
      <div className="lp-why__head">
        <div>
          <h2 className="lp-h2">
            Don’t take our
            <br />
            word for it.
          </h2>
          <p className="lp-why__sub">Run it yourself and get the same numbers.</p>
        </div>
        <p className="lp-mono lp-why__aside">
          RUN IT AGAIN
          <br />
          AND YOU GET
          <br />
          THE SAME NUMBERS.
        </p>
      </div>
      <Pillars />
      <Stats />
    </section>
  );
}

function Tiers(): React.JSX.Element {
  return (
    <section className="lp-sec lp-tiers" id="evidence">
      <Ticks />
      <div className="lp-tiers__head">
        <h2 className="lp-h3">
          Rules say what happened. The model says how bad it looks. Policy says what you’re allowed
          to do.
        </h2>
        <span className="lp-mono lp-tiers__aside">THREE LAYERS, ONE DECISION</span>
      </div>
      <p className="lp-body lp-tiers__lede">
        None of them decides alone, by design. A score is an opinion, not a verdict — it has to
        match the evidence and pass a policy before anything reaches a shopper, and you see every
        step of that argument.
      </p>
      <div className="lp-tiergrid">
        {TIERS.map((t, i) => (
          <RevealCard className="lp-tier" index={i} key={t.name}>
            <span className="lp-mono lp-tier__tag">{t.tag}</span>
            <div className="lp-tier__art">
              <Art kind={t.art} />
            </div>
            <h4 className="lp-tier__name">{t.name}</h4>
            <span className="lp-mono lp-tier__role">{t.role}</span>
          </RevealCard>
        ))}
      </div>
    </section>
  );
}

function DirectCta(): React.JSX.Element {
  return (
    <section className="lp-sec lp-direct">
      <Ticks />
      <h2 className="lp-h2">
        Want the reasoning,
        <br />
        not just a score?
      </h2>
      <p className="lp-mono lp-direct__aside">
        BUILT FOR THE RAZORPAY AI BUILDATHON
        <br />
        TRACK 02 — AI RISK MANAGER
      </p>
      <Link to="/login" className="lp-underlink">
        OPEN THE CONSOLE
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

/**
 * The three steps, as a control rather than a list.
 *
 * Selection lives in `Ecosystem` because this and the panel beside it are two halves of one
 * widget: pressing a row here is what changes the card shown there. Keeping the state in the
 * parent is what lets the pair stay in step.
 */
function EcoAccordion({
  open,
  onOpen,
}: {
  open: number;
  onOpen: (index: number) => void;
}): React.JSX.Element {
  return (
    <ul className="lp-eco__acc">
      {ACCORDION.map((item, i) => (
        <li key={item.title} className={open === i ? 'is-open' : ''}>
          <button
            type="button"
            onClick={() => onOpen(i)}
            aria-expanded={open === i}
            aria-controls="lp-eco-panel"
          >
            <span>{item.title}</span>
            <span className="lp-eco__acc-sign" aria-hidden="true">
              {open === i ? '−' : '+'}
            </span>
          </button>
          {open === i && <p>{item.body}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Where the scroll sequence turns off and the section becomes an ordinary stack. Matches the
 *  `max-width: 60rem` breakpoint the stylesheet already uses to drop this section to one column. */
const ECO_SEQUENCE_QUERY = '(min-width: 60.0625rem)';

/**
 * A media query, safely.
 *
 * jsdom has no `matchMedia`, and a component test renders this page without one. Answering "no"
 * where the API is missing is also the right default for the two questions asked below: no pinned
 * stage, and no reduced-motion preference to honour.
 */
const mediaMatches = (query: string): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

/** The scroll distance a pinned stage travels across, in pixels. Zero below the breakpoint. */
const runwayOf = (node: HTMLElement): number =>
  mediaMatches(ECO_SEQUENCE_QUERY) ? Math.max(0, node.offsetHeight - window.innerHeight) : 0;

/**
 * A pinned sequence: which of `count` steps the reader has scrolled to inside the returned section.
 *
 * The section is given a runway several screens deep and something inside it pins to the viewport;
 * this turns how far through that runway the page has travelled into an index. Below the breakpoint
 * the runway collapses to nothing, the measurement is skipped, and `goTo` just sets the index — the
 * section is an ordinary stack there and has no pinned stage to scroll against.
 *
 * `goTo` scrolls rather than assigning, because assigning would be undone by the very next scroll
 * event. Moving the page is what makes a press and a scroll the same gesture.
 */
function useScrollSequence(count: number): {
  section: React.RefObject<HTMLElement | null>;
  index: number;
  goTo: (index: number) => void;
} {
  const [index, setIndex] = useState(0);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = section.current;
    if (node === null) return;

    let frame = 0;
    const measure = (): void => {
      const distance = runwayOf(node);
      if (distance === 0) return;
      const travelled = -node.getBoundingClientRect().top;
      const progress = Math.min(Math.max(travelled / distance, 0), 0.999);
      setIndex(Math.floor(progress * count));
    };
    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [count]);

  const goTo = (next: number): void => {
    const node = section.current;
    const distance = node === null ? 0 : runwayOf(node);
    if (node === null || distance === 0) {
      setIndex(next);
      return;
    }
    // Land in the middle of that step's stretch, so the card is settled rather than on a boundary.
    const top = node.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: top + (distance * (next + 0.5)) / count,
      behavior: mediaMatches('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth',
    });
  };

  return { section, index, goTo };
}

function Ecosystem(): React.JSX.Element {
  // One step at a time, driven by scroll: the stage pins to the viewport and the card on it changes
  // as the runway beneath travels past. The accordion is the same control by another route.
  const { section, index: open, goTo } = useScrollSequence(PIPELINE.length);
  const step = PIPELINE[open]!;

  return (
    <section className="lp-eco" id="pipeline" ref={section}>
      <div className="lp-eco__left">
        {/* Inside the pinned panel, so the light travels with the heading it lights. */}
        <div className="lp-eco__glow" aria-hidden="true" />
        {/* The panel is a one-screen flex box that centres this; the copy inside keeps ordinary
            block layout, so the pill button stays its own width instead of stretching. */}
        <div className="lp-eco__intro">
          <h2 className="lp-h2 lp-eco__h2">
            One path,
            <br />
            from webhook
            <br />
            to verdict.
          </h2>
          <p className="lp-eco__sub">
            Encrypted the moment it arrives, grouped into a case, judged by the rules and the model
            together, then acted on under a policy you approved.
          </p>
          <Link to="/login" className="lp-btn lp-btn--ghost">
            See the platform in action
            <span className="lp-btn__arrow" aria-hidden="true">
              ▶
            </span>
          </Link>
          <EcoAccordion open={open} onOpen={goTo} />
        </div>
      </div>
      <div className="lp-eco__right">
        {/* The stage pins to the viewport while the runway beneath it scrolls. The card is keyed on
            the step so React remounts it and the entrance replays each time the step changes. */}
        <div className="lp-eco__stage">
          <article className="lp-eco__card lp-eco__card--active" id="lp-eco-panel" key={step.title}>
            <div className="lp-eco__art">
              <Art kind={step.art} />
            </div>
            <h4>{step.title}</h4>
            <p>{step.body}</p>
          </article>
        </div>
      </div>
    </section>
  );
}

function Faq(): React.JSX.Element {
  const [open, setOpen] = useState(0);
  return (
    <section className="lp-sec lp-faq" id="faq">
      <Ticks />
      <div className="lp-faq__head">
        <h2 className="lp-h2">
          Frequently Asked
          <br />
          Questions
        </h2>
        <p className="lp-body lp-faq__lede">
          If it’s not here, the console will show you with live evidence.
        </p>
      </div>
      <div className="lp-faq__body">
        <span className="lp-mono lp-faq__aside">COMMON QUESTIONS</span>
        <ul className="lp-faq__list">
          {FAQ.map((item, i) => (
            <li key={item.q} className={open === i ? 'is-open' : ''}>
              <button type="button" onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="lp-mono lp-faq__n">{`/0${i + 1}`.replace('/010', '/10')}</span>
                <span className="lp-faq__q">{item.q}</span>
                <span className="lp-faq__sign" aria-hidden="true">
                  {open === i ? '×' : '+'}
                </span>
              </button>
              {open === i && <p className="lp-faq__a">{item.a}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FootNav(): React.JSX.Element {
  return (
    <nav className="lp-foot__nav">
      {NAV.map((item) => (
        <a key={item.label} href={item.href}>
          {item.label.toUpperCase()}
        </a>
      ))}
      <StorefrontLink>STOREFRONT</StorefrontLink>
    </nav>
  );
}

function Foot({ state }: { state: MetaState }): React.JSX.Element {
  const build =
    state.kind === 'ready'
      ? `v${state.meta.version} · ${state.meta.commit}`
      : 'RAZORPAY BUILDATHON';
  return (
    <footer className="lp-foot">
      <div className="lp-foot__top">
        <div className="lp-foot__brand">
          <a className="lp-brand" href="#top">
            <img src={razorpayLogo} alt="Razorpay" className="lp-brand__rzp" />
            <span className="lp-brand__div" aria-hidden="true" />
            <span className="lp-brand__name">SENTINEL</span>
          </a>
          <FootNav />
        </div>
        <div className="lp-foot__credit">
          <span className="lp-mono lp-foot__creditlabel">DESIGNED &amp; BUILT BY</span>
          <p className="lp-foot__author">Aswin Kumar</p>
          <p className="lp-foot__authorline">
            Sentinel is a solo build for the Razorpay AI Buildathon — the detection engine, the
            model pipeline, the console and this page.
          </p>
          <div className="lp-foot__social">
            <a href="https://github.com/Aswin-Kumar7" target="_blank" rel="noreferrer">
              <IconGitHub />
              <span>GitHub</span>
            </a>
            <a href="https://www.linkedin.com/in/aswinkumar7/" target="_blank" rel="noreferrer">
              <IconLinkedIn />
              <span>LinkedIn</span>
            </a>
          </div>
        </div>
      </div>
      <div className="lp-foot__bottom">
        <a href="#top" className="lp-mono">
          BACK TO TOP ↑
        </a>
        <span className="lp-mono">{build}</span>
        <span className="lp-mono">© 2026 SENTINEL. ALL RIGHTS RESERVED.</span>
      </div>
      <div className="lp-foot__mark" aria-hidden="true">
        SENTINEL
      </div>
    </footer>
  );
}

export function Landing(): React.JSX.Element {
  const state = useMeta();
  return (
    <div className="lp" id="top">
      {/* One bounded column for every band — dark and light alike — so the page keeps a single
          set of edges on a wide screen instead of alternating full-bleed and centred. */}
      <div className="lp-page">
        <div className="lp-top">
          <BuildathonBanner />
          <LandingNav />
          <div className="lp-top__dome" aria-hidden="true">
            <div className="lp-top__dome-core" />
          </div>
          <Hero />
          <StackBand />
        </div>
        <Results />
        <WhyLeaders />
        <Tiers />
        <DirectCta />
        <Ecosystem />
        <Faq />
        <Foot state={state} />
      </div>
    </div>
  );
}
