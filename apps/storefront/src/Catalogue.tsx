import { useMemo, useState } from 'react';
import type { CatalogItem } from '@sentinel/contracts';
import { ProductArt } from './ProductArt.js';
import { rupees } from './money.js';

/** One product: artwork, name, price, and the round add button the reference hangs off each card. */
function ShopCard({
  item,
  quantity,
  onAdd,
}: {
  item: CatalogItem;
  quantity: number;
  onAdd: () => void;
}): React.JSX.Element {
  return (
    <article className="card">
      <div className="card__art">
        <ProductArt sku={item.sku} className="card__img" />
        {quantity > 0 && <span className="card__count">{quantity} in cart</span>}
      </div>
      <h3 className="card__name">{item.name}</h3>
      <p className="card__desc">{item.description}</p>
      <p className="card__price">{rupees(item.pricePaise)}</p>
      <button
        type="button"
        className="card__add"
        onClick={onAdd}
        aria-label={`Add ${item.name} to cart`}
      >
        +
      </button>
    </article>
  );
}

export interface CatalogueProps {
  catalog: CatalogItem[];
  cart: Record<string, number>;
  onAdd: (sku: string) => void;
  loading: boolean;
  failed: boolean;
}

const ALL = 'All';

/** The tabbed grid. Tabs come from the catalogue's own categories, so they cannot drift from it. */
export function Catalogue(props: CatalogueProps): React.JSX.Element {
  const [tab, setTab] = useState(ALL);

  const tabs = useMemo(() => {
    const seen = new Set(props.catalog.map((item) => item.category));
    return [ALL, ...[...seen].sort()];
  }, [props.catalog]);

  const shown = tab === ALL ? props.catalog : props.catalog.filter((item) => item.category === tab);

  return (
    <section className="picks" id="shop" aria-label="Shop">
      <div className="picks__inner">
        <p className="eyebrow eyebrow--center">
          <span aria-hidden="true" />
          Our top picks
          <span aria-hidden="true" />
        </p>
        <h2 className="picks__title">More Than Just Coffee.</h2>

        {tabs.length > 1 && (
          <div className="tabs" role="tablist" aria-label="Filter the shop by category">
            {tabs.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                className={tab === name ? 'is-active' : undefined}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {props.loading && <p className="picks__status">Loading the shop…</p>}
        {props.failed && (
          <p className="picks__status picks__status--bad" role="alert">
            The shop could not be loaded. The API may not be running.
          </p>
        )}

        <div className="grid">
          {shown.map((item) => (
            <ShopCard
              key={item.sku}
              item={item}
              quantity={props.cart[item.sku] ?? 0}
              onAdd={() => props.onAdd(item.sku)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
