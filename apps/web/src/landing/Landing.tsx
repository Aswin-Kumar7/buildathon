import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMeta, type MetaState } from './useMeta.js';
import { STOREFRONT_URL } from '../links.js';
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
  { label: 'Detection', href: '#detection' },
  { label: 'Evidence', href: '#evidence' },
  { label: 'Pipeline', href: '#pipeline' },
  { label: 'FAQ', href: '#faq' },
];

/** The stack the product actually runs on — a truthful stand-in for a customer logo wall. */
const STACK: BrandName[] = ['Razorpay', 'NestJS', 'React', 'PostgreSQL', 'Groq', 'Azure'];

const APART = [
  { n: '/01', title: 'Precision-first', meta: 'CALIBRATED, NOT GUESSED' },
  { n: '/02', title: 'Built for Razorpay', meta: 'WEBHOOK-NATIVE, ZERO CARD DATA' },
  { n: '/03', title: 'Reversible by design', meta: 'NOTHING BLOCKS A SHOPPER ALONE' },
  { n: '/04', title: 'Transparent evidence', meta: 'HASH-LINKED, FULLY AUDITABLE' },
];

const PILLARS = [
  {
    label: 'MEASURED ACCURACY',
    body: 'Scored on a held-out, grouped split — a seed the model trained on never appears in the test set.',
    foot: 'PR-AUC 0.94 / ROC-AUC 0.98',
  },
  {
    label: 'FALSE POSITIVES',
    body: 'Eleven benign and operational scenarios replayed end to end. None of them opened an incident.',
    foot: 'ZERO ON THE COMMITTED CORPUS',
  },
  {
    label: 'HUMAN IN THE LOOP',
    body: 'Containment is reversible, expiring and approval-gated. The model can only ever ask for a person.',
    foot: 'NO AUTOMATIC BLOCKING',
  },
  {
    label: 'FULL PROVENANCE',
    body: 'Every decision is hash-linked to the evidence and the policy version that produced it.',
    foot: 'TAMPER-EVIDENT CHAIN',
  },
];

const STATS = [
  { value: '0.94', cap: 'PR-AUC ON A HELD-OUT GROUPED SPLIT' },
  { value: '97%', cap: 'OF ATTACKS RECALLED IN EVALUATION' },
  { value: '0', cap: 'FALSE POSITIVES ACROSS BENIGN RUNS' },
];

const TIERS = [
  {
    tag: '[ TIER 01 — DETERMINISTIC ]',
    name: 'Rules & Arbitration',
    role: 'CLUSTERS ATTEMPTS INTO ONE INCIDENT',
    art: 'rules' as const,
  },
  {
    tag: '[ TIER 02 — LEARNED ]',
    name: 'Calibrated Model',
    role: 'SCORES RISK, NEVER BLOCKS ALONE',
    art: 'model' as const,
  },
  {
    tag: '[ TIER 03 — HUMAN ]',
    name: 'Policy & Approval',
    role: 'REVERSIBLE, EXPIRING, APPROVED',
    art: 'policy' as const,
  },
];

const PIPELINE = [
  {
    title: 'Signals joined across session, device and network.',
    body: 'Razorpay’s webhooks carry no IP, device or session. The storefront sensor captures that context and Sentinel correlates it, so one attack sprayed across a proxy pool reads as a single incident rather than thirty invisible ones.',
    art: 'correlate' as const,
  },
  {
    title: 'Rigorous validation to ensure peak performance.',
    body: 'The model is trained and evaluated in Python, then served as the linear map it is — with calibration, a leakage-controlled split and a cost-optimal operating point reported beside it, never a demo number bolted on afterwards.',
    art: 'validate' as const,
  },
  {
    title: 'Consistent, reversible automated execution.',
    body: 'Rules and model combine into a policy decision: observe, review or contain. Containment expires on its own and can be released instantly, so a wrong call costs minutes rather than customers.',
    art: 'contain' as const,
  },
];

const ACCORDION = [
  {
    title: 'Correlate what webhooks cannot carry',
    body: 'Payments are joined to the checkout session, device and network that produced them.',
  },
  {
    title: 'Score with a model you can audit',
    body: 'Exact per-feature contributions, because the served model is linear by design.',
  },
  {
    title: 'Contain without punishing shoppers',
    body: 'Every containment is reversible, time-boxed and recorded against its approver.',
  },
];

const FAQ = [
  {
    q: 'Do I need to change my checkout to use Sentinel?',
    a: 'No. Sentinel consumes the Razorpay webhooks you already emit. The only optional addition is a lightweight storefront sensor supplying the session, device and network context webhooks cannot carry — and detection still runs without it, just with fewer correlation keys.',
  },
  {
    q: 'What kind of fraud does it actually catch?',
    a: 'Card testing and enumeration: an attacker walking a list of stolen cards through your checkout to find the live ones. Sentinel recognises the loud, the slow, the low-amplitude and the distributed variants, and tells them apart from a gateway outage, a retry storm or a flash sale.',
  },
  {
    q: 'Will it block real customers by mistake?',
    a: 'It cannot block anyone on its own. The strongest action the model can take is to send a case to a person. Across the eleven benign and operational scenarios in the committed corpus it opened zero incidents, and every containment a human does approve is reversible and expires by itself.',
  },
  {
    q: 'How accurate is the model, really?',
    a: 'PR-AUC 0.94, ROC-AUC 0.98, recall 0.97 and a Brier score of 0.044 on a held-out split grouped so no scenario seed leaks between train and test. Those are the deployed model’s own numbers, not a separate benchmark, and the labels are declared synthetic until your confirmed incidents replace them.',
  },
  {
    q: 'What happens if the model is unavailable?',
    a: 'The system degrades to its deterministic rules and arbitration and says so plainly — the console marks the decision degraded:model. Losing the model costs you an explanation, never the safety of what gets done.',
  },
  {
    q: 'Is my payment and customer data safe?',
    a: 'Sentinel never sees a card number. Raw webhook payloads are sealed and encrypted at rest, identifiers are stored as salted pseudonyms, and a payload-leak check runs in CI to prove none of it reaches logs or the console.',
  },
  {
    q: 'How quickly does it detect an attack?',
    a: 'Detection runs continuously over a rolling window; in the simulator a distributed attack surfaces around ten seconds after the burst begins. Model scoring is a few dot products in the request path, so it adds no meaningful latency.',
  },
  {
    q: 'Can I see why a decision was made?',
    a: 'Every incident shows which rules fired, the exact per-feature contributions behind the model’s estimate, the traffic it was judged against, and the policy that turned that into an action. Because the served model is linear, those contributions are exact rather than an approximation.',
  },
  {
    q: 'Does it learn from my traffic over time?',
    a: 'Yes. Incidents you confirm or dismiss become labels, and the retraining path swaps the synthetic cold-start corpus for your own outcomes. Each model version is registered with the feature definition and data hash it was built from.',
  },
  {
    q: 'How do I try it without risking real traffic?',
    a: 'The console ships a scenario simulator. Pick an attack or a benign shape, stream it through the real ingestion path, and watch detection, scoring, policy and the audit trail respond exactly as they would in production.',
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
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="lp-nav__alt">
            Storefront
          </a>
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
    <section className="lp-hero" id="top">
      <div className="lp-hero__in">
        <span className="lp-badge">
          <span className="lp-badge__dot" aria-hidden="true" />
          SENTINEL v0.21 IS NOW LIVE
        </span>
        <h1 className="lp-hero__h1">
          AI Fraud &amp; Abuse Detection
          <br />
          for Every Razorpay Payment.
        </h1>
        <p className="lp-hero__sub">
          Sentinel watches your checkout for card testing and payment abuse — correlating the
          signals webhooks cannot carry, scoring every entity with a calibrated model, and
          containing attacks reversibly, never without a person.
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
        <span className="lp-stack__label">Built on the rails your checkout already runs on</span>
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
          Focused on Signal,
          <br />
          Not Noise.
        </h2>
        <p className="lp-body">
          Most fraud tooling buries a team in alerts. Sentinel groups an entire attack into one
          incident, explains it in plain words, and shows exactly what it would do next.
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
            Why Risk Teams Trust
            <br />
            the Numbers.
          </h2>
          <p className="lp-why__sub">Measured detection. Honestly stated limits.</p>
        </div>
        <p className="lp-mono lp-why__aside">
          BRIDGING RAW WEBHOOKS
          <br />
          TO DECISIONS ACROSS
          <br />
          EVERY ENTITY.
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
          Where deterministic rules meet a calibrated model to deliver decisions you can defend.
        </h2>
        <span className="lp-mono lp-tiers__aside">A COLLECTIVE OF ENGINES</span>
      </div>
      <p className="lp-body lp-tiers__lede">
        No single tier decides alone. Rules establish what happened, the model weighs how much it
        looks like abuse, and policy decides what a human is allowed to do about it.
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
        Skip the Black Box. See Exactly
        <br />
        Why It Was Flagged.
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

function EcoAccordion(): React.JSX.Element {
  const [open, setOpen] = useState(0);
  return (
    <ul className="lp-eco__acc">
      {ACCORDION.map((item, i) => (
        <li key={item.title} className={open === i ? 'is-open' : ''}>
          <button type="button" onClick={() => setOpen(i)}>
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

function Ecosystem(): React.JSX.Element {
  return (
    <section className="lp-eco" id="pipeline">
      {/* Anchored to the section corner, not the panel: the panel sticks, and a glow that travelled
          with it would drift away from the corner it belongs to. */}
      <div className="lp-eco__glow" aria-hidden="true" />
      <div className="lp-eco__left">
        <h2 className="lp-h2 lp-eco__h2">
          One Pipeline,
          <br />
          Total Visibility.
          <br />
          From webhook to verdict.
        </h2>
        <p className="lp-eco__sub">
          Every payment attempt travels the same accountable path: sealed on arrival, correlated
          into an entity, judged by rules and a model together, then acted on under a policy a
          person approved — with each step written to a tamper-evident chain.
        </p>
        <Link to="/login" className="lp-btn lp-btn--ghost">
          See the platform in action
          <span className="lp-btn__arrow" aria-hidden="true">
            ▶
          </span>
        </Link>
        <EcoAccordion />
      </div>
      <div className="lp-eco__right">
        {PIPELINE.map((p, i) => (
          <RevealCard className="lp-eco__card" index={i} key={p.title}>
            <div className="lp-eco__art">
              <Art kind={p.art} />
            </div>
            <h4>{p.title}</h4>
            <p>{p.body}</p>
          </RevealCard>
        ))}
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
          We bridge the gap between a suspicious failure and an operational answer. If your question
          is not here, the console answers most of them with live evidence.
        </p>
      </div>
      <div className="lp-faq__body">
        <span className="lp-mono lp-faq__aside">GET TO KNOW US</span>
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
      <a href={STOREFRONT_URL} target="_blank" rel="noreferrer">
        STOREFRONT
      </a>
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
    <div className="lp">
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
