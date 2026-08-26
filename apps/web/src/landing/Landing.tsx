import { Link } from '@tanstack/react-router';
import { Button } from '@sentinel/ui';
import { useMeta } from './useMeta.js';
import { STOREFRONT_URL } from '../links.js';
import { Icon, type IconName } from '../shell/icons.js';
import './Landing.css';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'shield',
    title: 'Sees what webhooks miss',
    body: 'Razorpay’s payment webhooks carry no IP, device or session. Sentinel’s storefront sensor captures that context and correlates it — so a distributed attack spread across a proxy pool is one incident, not thirty invisible ones.',
  },
  {
    icon: 'model',
    title: 'A model you can trust',
    body: 'One deployed risk model, scored on a held-out split with honest precision, recall, PR-AUC and false-positive cost. The number you’re shown is the model that actually runs — no benchmark bolted on beside it.',
  },
  {
    icon: 'policies',
    title: 'Safe by construction',
    body: 'Nothing blocks a shopper automatically. Containment is reversible, expiring and needs human approval; the model can only ever ask for a person. If the model is absent, the system degrades to deterministic rules.',
  },
  {
    icon: 'audit',
    title: 'Every decision accountable',
    body: 'A hash-linked audit chain records who decided what, on which evidence, under which policy. Confirmed incidents become the labels the model retrains on — so it learns from your own traffic over time.',
  },
];

const PIPELINE = [
  { k: 'Ingest', v: 'Verify, encrypt and redact every Razorpay webhook.' },
  { k: 'Correlate', v: 'Join payments to the storefront’s session, device and network context.' },
  { k: 'Detect', v: 'Deterministic rules cluster attempts into one incident per episode.' },
  { k: 'Score', v: 'The calibrated model rates each entity’s card-testing risk.' },
  { k: 'Decide', v: 'Rules + model → policy → observe, review or contain.' },
  { k: 'Audit', v: 'Every step recorded, reversible, and attributable.' },
];

function Preview(): React.JSX.Element {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-preview__bar">
        <span className="lp-preview__dot" />
        <span className="lp-preview__dot" />
        <span className="lp-preview__dot" />
        <span className="lp-preview__title">Sentinel · Overview</span>
      </div>
      <div className="lp-preview__body">
        <div className="lp-preview__stats">
          <div className="lp-ptile lp-ptile--crit">
            <span>Active</span>
            <strong>2</strong>
          </div>
          <div className="lp-ptile lp-ptile--ok">
            <span>Recall</span>
            <strong>97%</strong>
          </div>
          <div className="lp-ptile lp-ptile--accent">
            <span>PR-AUC</span>
            <strong>0.94</strong>
          </div>
        </div>
        <div className="lp-prow lp-prow--crit">
          <span className="lp-pchip">HIGH</span>
          <span className="lp-pentity">session · SIM7f2a…</span>
          <span className="lp-pstate">Contained</span>
        </div>
        <div className="lp-prow">
          <span className="lp-pchip lp-pchip--warn">MED</span>
          <span className="lp-pentity">network · /24 198.51…</span>
          <span className="lp-pstate lp-pstate--warn">Review</span>
        </div>
        <div className="lp-prow">
          <span className="lp-pchip lp-pchip--ok">LOW</span>
          <span className="lp-pentity">session · SIM0b9c…</span>
          <span className="lp-pstate lp-pstate--ok">Cleared</span>
        </div>
      </div>
    </div>
  );
}

function Nav(): React.JSX.Element {
  return (
    <header className="lp-nav">
      <div className="lp-nav__inner">
        <a className="lp-brand" href="/">
          <span className="lp-brand__mark">
            <Icon name="shield" size={18} />
          </span>
          Sentinel
        </a>
        <nav className="lp-nav__links">
          <a href="#how">How it works</a>
          <a href="#trust">Why trust it</a>
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer">
            Storefront
          </a>
          <Link to="/login">
            <Button size="sm">Open console</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero(): React.JSX.Element {
  return (
    <section className="lp-hero">
      <div className="lp-hero__text">
        <span className="lp-eyebrow">Razorpay AI Buildathon · Track 02 — AI Risk Manager</span>
        <h1>Catch card testing before it drains your gateway.</h1>
        <p className="lp-sub">
          Sentinel is a merchant-side risk console for your Razorpay checkout. It correlates the
          signals webhooks can’t carry, scores every entity with a calibrated model you can actually
          trust, and contains abuse safely — reversibly, and never without a person.
        </p>
        <div className="lp-cta">
          <Link to="/login">
            <Button size="lg" icon="→">
              Open the console
            </Button>
          </Link>
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer" className="lp-secondary-link">
            <Button variant="secondary" size="lg">
              View the storefront
            </Button>
          </a>
        </div>
        <p className="lp-demohint">
          Demo login <code>analyst@sentinel.local</code> · <code>sentinel-demo</code>
        </p>
      </div>
      <div className="lp-hero__art">
        <Preview />
      </div>
    </section>
  );
}

function Trust(): React.JSX.Element {
  const metrics = [
    ['0.94', 'PR-AUC on held-out data'],
    ['97%', 'of attacks caught (recall)'],
    ['6.5%', 'false-decline rate'],
    ['0', 'shoppers auto-blocked'],
  ];
  return (
    <section className="lp-trust" id="trust">
      <div className="lp-trust__inner">
        {metrics.map(([v, l]) => (
          <div className="lp-metric" key={l}>
            <strong>{v}</strong>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <p className="lp-trust__note">
        The deployed model’s own numbers, measured honestly — labels declared synthetic, not
        real-world outcomes.
      </p>
    </section>
  );
}

function Features(): React.JSX.Element {
  return (
    <section className="lp-features">
      <div className="lp-section-head">
        <span className="lp-kicker">Why Sentinel</span>
        <h2>Detection you can defend to a merchant.</h2>
      </div>
      <div className="lp-feature-grid">
        {FEATURES.map((f) => (
          <article className="lp-feature" key={f.title}>
            <span className="lp-feature__icon">
              <Icon name={f.icon} size={20} />
            </span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HowItWorks(): React.JSX.Element {
  return (
    <section className="lp-how" id="how">
      <div className="lp-section-head">
        <span className="lp-kicker">How it works</span>
        <h2>From a webhook to an accountable decision.</h2>
      </div>
      <ol className="lp-pipeline">
        {PIPELINE.map((step, i) => (
          <li key={step.k}>
            <span className="lp-pipeline__n">{i + 1}</span>
            <div>
              <h4>{step.k}</h4>
              <p>{step.v}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Honesty(): React.JSX.Element {
  return (
    <section className="lp-honesty">
      <div className="lp-honesty__inner">
        <span className="lp-kicker">The difference</span>
        <h2>The model you’re shown is the model that runs.</h2>
        <p>
          Most fraud demos show you a benchmark score from a model that never touches production.
          Sentinel serves the same calibrated risk model it reports precision and recall for, on the
          same live feature space — and says plainly where it’s strong, where it struggles, and that
          its cold-start labels are synthetic until your own confirmed incidents replace them.
        </p>
        <Link to="/login" className="lp-honesty__link">
          See the honest evaluation →
        </Link>
      </div>
    </section>
  );
}

function FinalCta(): React.JSX.Element {
  return (
    <section className="lp-final">
      <div className="lp-final__card">
        <h2>Run the whole thing yourself.</h2>
        <p>
          Open the console, simulate an attack, and watch it flow through detection, the model, the
          policy and the audit trail — end to end, in the browser.
        </p>
        <div className="lp-cta">
          <Link to="/login">
            <Button size="lg" icon="→">
              Open the console
            </Button>
          </Link>
          <a href={STOREFRONT_URL} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="lg">
              Try the storefront
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

function Foot({ state }: { state: ReturnType<typeof useMeta> }): React.JSX.Element {
  return (
    <footer className="lp-foot">
      <div className="lp-foot__inner">
        <span className="lp-brand">
          <span className="lp-brand__mark">
            <Icon name="shield" size={16} />
          </span>
          Sentinel
        </span>
        <span className="lp-foot__meta">
          {state.kind === 'ready'
            ? `v${state.meta.version} · ${state.meta.commit} · Razorpay AI Buildathon 2026`
            : 'Razorpay AI Buildathon 2026'}
        </span>
      </div>
    </footer>
  );
}

export function Landing(): React.JSX.Element {
  const state = useMeta();
  return (
    <div className="lp">
      <Nav />
      <Hero />
      <Trust />
      <Features />
      <HowItWorks />
      <Honesty />
      <FinalCta />
      <Foot state={state} />
    </div>
  );
}
