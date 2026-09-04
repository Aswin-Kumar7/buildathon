import { useEffect, useRef } from 'react';
import type { CheckoutOutcome } from './checkout.js';

/**
 * What happened to the payment, said once and clearly.
 *
 * The outcome used to appear as a panel far down the page, where the shopper had just been
 * looking at Razorpay's own modal — so the answer to "did that work?" arrived somewhere they
 * were not looking. A dialog replaces the modal they were already watching, which is where
 * their attention already is.
 */

export type PaymentPhase =
  | { kind: 'creating' }
  | { kind: 'outcome'; outcome: CheckoutOutcome }
  | { kind: 'error'; message: string };

interface Copy {
  tone: 'ok' | 'warn' | 'bad' | 'busy';
  title: string;
  body: string;
  note?: string;
}

function copyFor(phase: PaymentPhase): Copy {
  if (phase.kind === 'creating') {
    return { tone: 'busy', title: 'Opening checkout', body: 'Creating your order with Razorpay…' };
  }
  if (phase.kind === 'error') {
    return { tone: 'bad', title: "We couldn't start checkout", body: phase.message };
  }
  const { outcome } = phase;
  if (outcome.kind === 'paid') {
    return {
      tone: 'ok',
      title: 'Payment successful',
      body: 'Your order is confirmed. No real money moved — this shop runs on Razorpay test keys.',
      note: outcome.paymentId,
    };
  }
  if (outcome.kind === 'dismissed') {
    return {
      tone: 'warn',
      title: 'Checkout closed',
      body: 'You closed the payment window before paying. Your cart is untouched, so you can try again.',
    };
  }
  return {
    tone: 'bad',
    title: 'Payment failed',
    body: outcome.reason,
    note: 'Nothing was charged. Sentinel recorded the failed attempt.',
  };
}

/** The mark inside the ring. Each one draws itself, so the dialog has a beat of its own. */
function Mark({ tone }: { tone: Copy['tone'] }): React.JSX.Element {
  if (tone === 'busy') return <span className="pay-mark__spinner" aria-hidden="true" />;
  const d =
    tone === 'ok'
      ? 'M14 25 l8 8 l16-18'
      : tone === 'warn'
        ? 'M26 14 v16 M26 37 v1'
        : 'M16 16 l20 20 M36 16 l-20 20';
  return (
    <svg viewBox="0 0 52 52" aria-hidden="true">
      <path d={d} fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface PaymentStatusModalProps {
  phase: PaymentPhase | null;
  onClose: () => void;
  onRetry: () => void;
}

export function PaymentStatusModal({
  phase,
  onClose,
  onRetry,
}: PaymentStatusModalProps): React.JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  const busy = phase?.kind === 'creating';

  useEffect(() => {
    if (phase === null || busy) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, busy, onClose]);

  if (phase === null) return null;
  const copy = copyFor(phase);
  const failed =
    phase.kind === 'error' || (phase.kind === 'outcome' && phase.outcome.kind !== 'paid');

  return (
    <div
      className="pay-scrim"
      // While the order is being created there is nothing to decide, so the scrim does not
      // dismiss — closing it would leave a request in flight with no way back to its answer.
      onClick={busy ? undefined : onClose}
      role="presentation"
    >
      <div
        className={`pay-card pay-card--${copy.tone}`}
        role={busy ? 'status' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby="pay-title"
        aria-describedby="pay-body"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="pay-mark" aria-hidden="true">
          <Mark tone={copy.tone} />
        </span>
        <h2 id="pay-title">{copy.title}</h2>
        <p id="pay-body">{copy.body}</p>
        {copy.note !== undefined && <p className="pay-note">{copy.note}</p>}

        {!busy && (
          <div className="pay-actions">
            {failed && (
              <button type="button" className="pay-btn pay-btn--ghost" onClick={onRetry}>
                Try again
              </button>
            )}
            <button type="button" className="pay-btn" ref={closeRef} onClick={onClose}>
              {failed ? 'Back to the shop' : 'Continue shopping'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
