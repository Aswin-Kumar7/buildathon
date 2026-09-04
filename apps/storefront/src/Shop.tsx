import { useState } from 'react';
import { useStorefront } from './useStorefront.js';
import { SiteNav, Marquee, SiteFooter } from './SiteChrome.js';
import { Hero } from './Hero.js';
import { Catalogue } from './Catalogue.js';
import { Story } from './Story.js';
import { CartDrawer, type CartLine } from './CartDrawer.js';
import { PaymentStatusModal } from './PaymentStatusModal.js';
import './shop.css';

export function Shop(): React.JSX.Element {
  const shop = useStorefront();
  const [cartOpen, setCartOpen] = useState(false);

  const cartCount = Object.values(shop.cart).reduce((sum, quantity) => sum + quantity, 0);

  const lines: CartLine[] = shop.catalog
    .map((item) => {
      const quantity = shop.cart[item.sku] ?? 0;
      return {
        sku: item.sku,
        name: item.name,
        description: item.description,
        unitPaise: item.pricePaise,
        quantity,
        linePaise: item.pricePaise * quantity,
      };
    })
    .filter((line) => line.quantity > 0);

  // Adding opens the drawer, so the price the server just decided is visible immediately rather
  // than hidden behind a badge the shopper has to notice and then go looking for.
  const add = (sku: string): void => {
    shop.adjust(sku, 1);
    setCartOpen(true);
  };

  const startCheckout = (): void => {
    setCartOpen(false);
    shop.checkout();
  };

  const catalogueProps = {
    catalog: shop.catalog,
    cart: shop.cart,
    onAdd: add,
    loading: shop.loading,
    failed: shop.catalogFailed,
  };

  return (
    <div className="store">
      <SiteNav cartCount={cartCount} onOpenCart={() => setCartOpen(true)} />
      <Hero onShop={() => setCartOpen(false)} />
      <Marquee />
      <Catalogue {...catalogueProps} />
      <Story />
      <SiteFooter />

      <CartDrawer
        open={cartOpen}
        lines={lines}
        totalPaise={shop.totalPaise}
        email={shop.email}
        onEmailChange={shop.setEmail}
        onAdjust={shop.adjust}
        onClose={() => setCartOpen(false)}
        onCheckout={startCheckout}
      />

      <PaymentStatusModal
        phase={shop.phase}
        onClose={shop.dismissPhase}
        onRetry={() => {
          shop.dismissPhase();
          shop.checkout();
        }}
      />
    </div>
  );
}
