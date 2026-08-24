import { Button, Callout, Card } from '@sentinel/ui';
import type { CheckoutOutcome } from './checkout.js';
import { rupees } from './money.js';

export type Status =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'outcome'; outcome: CheckoutOutcome }
  | { kind: 'error'; message: string };

function Outcome({ outcome }: { outcome: CheckoutOutcome }): React.JSX.Element {
  if (outcome.kind === 'paid') {
    return (
      <Callout tone="ok" title="Payment captured">
        <p>Payment {outcome.paymentId} completed in test mode.</p>
      </Callout>
    );
  }

  // A closed window is not a decline. Conflating the two would put a spike of abandoned
  // checkouts into the same bucket as a spike of refused cards, which is the signal the
  // detector cares about most.
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
  email: string;
  onEmailChange: (email: string) => void;
  totalPaise: number;
  canCheckout: boolean;
  status: Status;
  onCheckout: () => void;
}

export function CheckoutPanel({
  email,
  onEmailChange,
  totalPaise,
  canCheckout,
  status,
  onCheckout,
}: CheckoutPanelProps): React.JSX.Element {
  return (
    <Card title="Checkout">
      <label htmlFor="email">Email (optional)</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        placeholder="you@example.com"
      />

      <p className="shop__total">
        Total <strong>{rupees(totalPaise)}</strong>
      </p>

      <Button onClick={onCheckout} disabled={!canCheckout || status.kind === 'creating'}>
        {status.kind === 'creating' ? 'Starting checkout…' : 'Pay with Razorpay'}
      </Button>

      {status.kind === 'error' && (
        <Callout tone="critical" title="Checkout failed">
          <p role="alert">{status.message}</p>
        </Callout>
      )}

      {status.kind === 'outcome' && <Outcome outcome={status.outcome} />}
    </Card>
  );
}
