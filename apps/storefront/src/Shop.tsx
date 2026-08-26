import { ProductCard } from './ProductCard.js';
import { CheckoutPanel, type CartLine } from './CheckoutPanel.js';
import { useStorefront } from './useStorefront.js';
import './shop.css';

function StoreNav({ cartCount }: { cartCount: number }): React.JSX.Element {
  return (
    <header className="store-nav">
      <div className="store-nav__inner">
        <a className="store-brand" href="/">
          <span className="store-brand__mark" aria-hidden="true">
            ☕
          </span>
          Brew &amp; Co
        </a>
        <nav className="store-nav__links" aria-label="Shop">
          <a href="#menu">Menu</a>
          <a href="#" aria-disabled="true">
            Subscriptions
          </a>
          <a href="#" aria-disabled="true">
            Our story
          </a>
        </nav>
        <div className="store-nav__right">
          <span className="store-secured" title="Protected by Sentinel">
            <span aria-hidden="true">🛡</span> Protected by Sentinel
          </span>
          <span className="store-cart-pill">
            <span aria-hidden="true">🛒</span> {cartCount}
          </span>
        </div>
      </div>
    </header>
  );
}

function StoreHero(): React.JSX.Element {
  return (
    <section className="store-hero">
      <div className="store-hero__inner">
        <div className="store-hero__text">
          <span className="store-hero__badge">Freshly roasted · test mode</span>
          <h1>Small-batch coffee, delivered to your door.</h1>
          <p>
            Ethically sourced beans, roasted to order and shipped within 24 hours. Checkout is a
            real Razorpay test-mode flow — every visit is exactly the kind of traffic Sentinel
            watches over.
          </p>
          <a className="store-hero__cta" href="#menu">
            Shop the menu →
          </a>
        </div>
        <div className="store-hero__art" aria-hidden="true">
          <span>☕</span>
        </div>
      </div>
    </section>
  );
}

export function Shop(): React.JSX.Element {
  const shop = useStorefront();
  const cartCount = Object.values(shop.cart).reduce((sum, q) => sum + q, 0);

  const lines: CartLine[] = shop.catalog
    .map((item) => {
      const quantity = shop.cart[item.sku] ?? 0;
      return { sku: item.sku, name: item.name, quantity, linePaise: item.pricePaise * quantity };
    })
    .filter((line) => line.quantity > 0);

  return (
    <div className="store">
      <StoreNav cartCount={cartCount} />
      <StoreHero />

      <main className="store-main" id="menu">
        <section className="store-products">
          <div className="store-section-head">
            <h2>Our menu</h2>
            <p>No real money moves — this shop runs on Razorpay test keys.</p>
          </div>

          {shop.catalog.length === 0 ? (
            <p className="store-loading" role="status">
              {shop.status.kind === 'error' ? 'Could not load the menu.' : 'Loading the menu…'}
            </p>
          ) : (
            <div className="store-grid">
              {shop.catalog.map((item, index) => (
                <ProductCard
                  key={item.sku}
                  item={item}
                  index={index}
                  quantity={shop.cart[item.sku] ?? 0}
                  onAdjust={(delta) => shop.adjust(item.sku, delta)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="store-aside">
          <CheckoutPanel
            lines={lines}
            totalPaise={shop.totalPaise}
            email={shop.email}
            onEmailChange={shop.setEmail}
            canCheckout={shop.canCheckout}
            status={shop.status}
            onCheckout={shop.checkout}
          />
        </aside>
      </main>

      <footer className="store-foot">
        <p>Brew &amp; Co — a demo storefront for Sentinel. No real orders, no real charges.</p>
      </footer>
    </div>
  );
}
