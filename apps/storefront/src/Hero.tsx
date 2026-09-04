import { HeroScene } from './SceneArt.js';

/**
 * The hero.
 *
 * The reference design closes this block with a ratings cluster — "4.7 · trusted by 3K
 * customers". This shop has no customers and no ratings, so that slot states things that are
 * actually true of it instead: the checkout is real, the money is not, and every attempt is
 * watched. It keeps the design's rhythm without inventing social proof.
 */

const FACTS: [string, string][] = [
  ['Live Razorpay checkout', 'Test keys — no real charges'],
  ['Watched by Sentinel', 'Every attempt, captured or failed'],
];

export function Hero({ onShop }: { onShop: () => void }): React.JSX.Element {
  return (
    <section className="hero" id="top">
      <div className="hero__inner">
        <div className="hero__text">
          <p className="eyebrow">
            <span aria-hidden="true" />
            Freshly roasted everyday
          </p>

          <h1>
            Your Daily Brew,
            <br />
            Ready When
            <br />
            You Are.
          </h1>

          <p className="hero__lede">
            Skip the morning queue. Order the kit that makes the cup — kettle, grinder, mug and
            filters — and have it waiting on your counter.
          </p>

          <div className="hero__cta">
            <a className="btn" href="#shop" onClick={onShop}>
              Get your coffee
            </a>
          </div>

          <ul className="hero__facts">
            {FACTS.map(([title, note]) => (
              <li key={title}>
                <span className="hero__dot" aria-hidden="true" />
                <span>
                  <strong>{title}</strong>
                  {note}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="hero__art">
          <HeroScene className="hero__scene" />
        </div>
      </div>
    </section>
  );
}
