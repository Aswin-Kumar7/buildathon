import { useEffect, useRef } from 'react';
import { rupees } from './money.js';
import { ProductArt } from './ProductArt.js';

export interface CartLine {
  sku: string;
  name: string;
  description: string;
  unitPaise: number;
  quantity: number;
  linePaise: number;
}

export interface CartDrawerProps {
  open: boolean;
  lines: CartLine[];
  totalPaise: number;
  email: string;
  onEmailChange: (email: string) => void;
  onAdjust: (sku: string, delta: number) => void;
  onClose: () => void;
  onCheckout: () => void;
}

function Line({
  line,
  onAdjust,
}: {
  line: CartLine;
  onAdjust: (sku: string, delta: number) => void;
}): React.JSX.Element {
  return (
    <li className="cart-line">
      <ProductArt sku={line.sku} className="cart-line__art" />
      <div className="cart-line__body">
        <p className="cart-line__name">{line.name}</p>
        <p className="cart-line__meta">{rupees(line.unitPaise)} each</p>
        <div className="cart-step">
          <button
            type="button"
            onClick={() => onAdjust(line.sku, -1)}
            aria-label={`Remove one ${line.name}`}
          >
            −
          </button>
          <span aria-live="polite">{line.quantity}</span>
          <button
            type="button"
            onClick={() => onAdjust(line.sku, 1)}
            aria-label={`Add one ${line.name}`}
          >
            +
          </button>
        </div>
      </div>
      <p className="cart-line__total">{rupees(line.linePaise)}</p>
    </li>
  );
}

export function CartDrawer(props: CartDrawerProps): React.JSX.Element {
  const { open, lines, totalPaise, onClose } = props;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind a drawer should not scroll with it; restoring the previous value rather
    // than clearing it keeps this from fighting anything else that locks the body.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return (
    <div className={`cart-root${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="cart-scrim" onClick={onClose} role="presentation" />
      <div
        className="cart-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
      >
        <header className="cart-head">
          <h2>Your cart</h2>
          <button type="button" className="cart-close" onClick={onClose} aria-label="Close cart">
            ✕
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="cart-empty">
            <p className="cart-empty__title">Nothing in the cart yet</p>
            <p>Add a piece of kit from the shop and it will show up here.</p>
          </div>
        ) : (
          <ul className="cart-lines">
            {lines.map((line) => (
              <Line key={line.sku} line={line} onAdjust={props.onAdjust} />
            ))}
          </ul>
        )}

        <footer className="cart-foot">
          <label className="cart-field">
            <span>Email for your receipt</span>
            <input
              type="email"
              value={props.email}
              placeholder="you@example.com"
              onChange={(event) => props.onEmailChange(event.target.value)}
            />
          </label>

          <div className="cart-total">
            <span>Total</span>
            {/* Named and polite: the number changes under the shopper as they step quantities,
                and a screen reader should say the new one without being asked. */}
            <strong aria-label="Cart total" aria-live="polite">
              {rupees(totalPaise)}
            </strong>
          </div>

          <button
            type="button"
            className="cart-pay"
            disabled={lines.length === 0}
            onClick={props.onCheckout}
          >
            Pay with Razorpay
          </button>
          <p className="cart-fineprint">
            Test mode — no real money moves. The card is entered inside Razorpay, never here.
          </p>
        </footer>
      </div>
    </div>
  );
}
