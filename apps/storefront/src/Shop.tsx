import { Badge, Callout } from '@sentinel/ui';
import { ProductCard } from './ProductCard.js';
import { CheckoutPanel } from './CheckoutPanel.js';
import { useStorefront } from './useStorefront.js';
import './shop.css';

export function Shop(): React.JSX.Element {
  const shop = useStorefront();

  return (
    <main className="shop">
      <header className="shop__head">
        <div>
          <p className="shop__eyebrow">Demo storefront</p>
          <h1>Brew &amp; Co</h1>
        </div>
        <Badge tone="warn">test mode</Badge>
      </header>

      <Callout tone="neutral" title="This shop exists to generate payment events">
        <p>
          It is the sensor for Sentinel: it records the request context that Razorpay&rsquo;s
          webhooks do not carry &mdash; a hashed network prefix, a device family and a session
          identifier &mdash; and hands them to the detector keyed on the order. Card details are
          entered inside Razorpay&rsquo;s own checkout and never reach this application.
        </p>
      </Callout>

      <section className="shop__grid">
        {shop.catalog.map((item) => (
          <ProductCard
            key={item.sku}
            item={item}
            quantity={shop.cart[item.sku] ?? 0}
            onAdjust={(delta) => shop.adjust(item.sku, delta)}
          />
        ))}
      </section>

      <section className="shop__checkout">
        <CheckoutPanel
          email={shop.email}
          onEmailChange={shop.setEmail}
          totalPaise={shop.totalPaise}
          canCheckout={shop.canCheckout}
          status={shop.status}
          onCheckout={shop.checkout}
        />
      </section>
    </main>
  );
}
