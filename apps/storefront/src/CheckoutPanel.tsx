import { Button, Callout, Field, Input } from '@sentinel/ui';
import type { CheckoutOutcome } from './checkout.js';
import { rupees } from './money.js';

export type Status =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'outcome'; outcome: CheckoutOutcome }
  | { kind: 'error'; message: string };

export interface CartLine {
  sku: string;
  name: string;
  quantity: number;
  linePaise: number;
}

function Outcome({ outcome }: { outcome: CheckoutOutcome }): React.JSX.Element {
  if (outcome.kind === 'paid') {
    return (
      <Callout tone="ok" title="Payment captured">
        <p>
          Order paid in test mode — payment {outcome.paymentId}. Sentinel saw the whole session.
        </p>
      </Callout>
    );
  }
  if (outcome.kind === 'dismissed') {
    return (
      <Callout tone="warn" title="Checkout closed">
        <p>You closed the payment window. The order still exists and was never paid.</p>
      </Callout>
    );
  }
  return (
    <Callout tone="critical" title="Payment failed">
      <p role="alert">{outcome.reason}</p>
    </Callout>
  );
}

export interface CheckoutPanelProps {
  lines: CartLine[];
  totalPaise: number;
  email: string;
  onEmailChange: (email: string) => void;
  canCheckout: boolean;
  status: Status;
  onCheckout: () => void;
}

export function CheckoutPanel({
  lines,
  totalPaise,
  email,
  onEmailChange,
  canCheckout,
  status,
  onCheckout,
}: CheckoutPanelProps): React.JSX.Element {
  return (
    <div className="cart">
      <div className="cart__head">
        <h2>Your cart</h2>
        <span className="cart__count">
          {lines.reduce((n, l) => n + l.quantity, 0)} item
          {lines.reduce((n, l) => n + l.quantity, 0) === 1 ? '' : 's'}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="cart__empty">Your cart is empty. Add something from the menu.</p>
      ) : (
        <ul className="cart__lines">
          {lines.map((line) => (
            <li key={line.sku}>
              <span className="cart__qty">{line.quantity}×</span>
              <span className="cart__name">{line.name}</span>
              <span className="cart__line">{rupees(line.linePaise)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="cart__total">
        <span>Total</span>
        <strong>{rupees(totalPaise)}</strong>
      </div>

      <div className="cart__email">
        <Field label="Email" hint="Optional — for your receipt.">
          {(id) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@example.com"
            />
          )}
        </Field>
      </div>

      <Button
        block
        size="lg"
        aria-label="Pay with Razorpay"
        onClick={onCheckout}
        disabled={!canCheckout || status.kind === 'creating'}
      >
        {status.kind === 'creating' ? 'Starting checkout…' : `Pay ${rupees(totalPaise)}`}
      </Button>

      <p className="cart__secure">
        🔒 Card details are entered in Razorpay’s checkout — never here.
      </p>

      {status.kind === 'error' && (
        <Callout tone="critical" title="Checkout failed">
          <p role="alert">{status.message}</p>
        </Callout>
      )}
      {status.kind === 'outcome' && <Outcome outcome={status.outcome} />}
    </div>
  );
}
