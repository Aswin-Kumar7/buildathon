import type { CatalogItem } from '@sentinel/contracts';
import { rupees } from './money.js';

export interface ProductCardProps {
  item: CatalogItem;
  quantity: number;
  onAdjust: (delta: number) => void;
}

// A warm palette so each product tile has its own identity without a real photo.
const GRADIENTS = [
  'linear-gradient(150deg, #7c4a2d, #b07a4e)',
  'linear-gradient(150deg, #4a3520, #7a5a38)',
  'linear-gradient(150deg, #9a5b3a, #c98b5e)',
  'linear-gradient(150deg, #3f2a1c, #6b4a30)',
  'linear-gradient(150deg, #8a6d3b, #b89b63)',
  'linear-gradient(150deg, #5c3d2e, #8a5f45)',
];

function visual(item: CatalogItem, index: number): { emoji: string; gradient: string } {
  const n = item.name.toLowerCase();
  const emoji = /cold|iced/.test(n)
    ? '🧊'
    : /bean|roast|blend/.test(n)
      ? '🫘'
      : /subscription|box|bundle/.test(n)
        ? '📦'
        : /tea|matcha/.test(n)
          ? '🍵'
          : '☕';
  return { emoji, gradient: GRADIENTS[index % GRADIENTS.length]! };
}

export function ProductCard({
  item,
  quantity,
  onAdjust,
  index = 0,
}: ProductCardProps & { index?: number }): React.JSX.Element {
  const { emoji, gradient } = visual(item, index);
  return (
    <article className={`product${quantity > 0 ? ' is-in-cart' : ''}`}>
      <div className="product__image" style={{ background: gradient }}>
        <span aria-hidden="true">{emoji}</span>
        {quantity > 0 && <span className="product__count">{quantity} in cart</span>}
      </div>
      <div className="product__body">
        <h3 className="product__name">{item.name}</h3>
        <p className="product__desc">{item.description}</p>
        <div className="product__foot">
          <span className="product__price">{rupees(item.pricePaise)}</span>
          {quantity === 0 ? (
            <button
              type="button"
              className="product__add"
              aria-label={`Add ${item.name} to cart`}
              onClick={() => onAdjust(1)}
            >
              Add to cart
            </button>
          ) : (
            <div className="product__qty" role="group" aria-label={`${item.name} quantity`}>
              <button
                type="button"
                onClick={() => onAdjust(-1)}
                aria-label={`Remove one ${item.name}`}
              >
                −
              </button>
              <span>{quantity}</span>
              <button type="button" onClick={() => onAdjust(1)} aria-label={`Add one ${item.name}`}>
                +
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
