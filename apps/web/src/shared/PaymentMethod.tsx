/**
 * The payment method of an attempt, drawn as the network's own mark plus its name.
 *
 * Shared so the attempts table and the device-history table on an attempt show a card the same way
 * — the device history used to print the bare word "Visa" beside a table that everywhere else
 * carries the logo.
 */
import { CreditCard, Wallet } from '@phosphor-icons/react';

import './PaymentMethod.css';

import visaLogo from '../assets/payments/visa.png';
import mastercardLogo from '../assets/payments/mastercard.svg';
import rupayLogo from '../assets/payments/rupay.png';
import amexLogo from '../assets/payments/amex.svg';
import upiLogo from '../assets/payments/upi.svg';
import netbankingLogo from '../assets/payments/netbanking.svg';

const CARD_BRANDS: Record<string, { logo: string; cls: string; label: string }> = {
  visa: { logo: visaLogo, cls: 'ap-method-logo--visa', label: 'Visa' },
  mastercard: { logo: mastercardLogo, cls: 'ap-method-logo--mc', label: 'Mastercard' },
  rupay: { logo: rupayLogo, cls: 'ap-method-logo--rupay', label: 'RuPay' },
  amex: { logo: amexLogo, cls: 'ap-method-logo--amex', label: 'Amex' },
};

/** Dragging a network's mark out of the table is never something anyone means to do. */
const preventSave = (event: React.MouseEvent): void => event.preventDefault();

function Mark({ src, cls }: { src: string; cls: string }): React.JSX.Element {
  return (
    <span className="ap-method-logo-wrap">
      <img
        src={src}
        alt=""
        className={`ap-method-logo ${cls}`}
        draggable={false}
        onContextMenu={preventSave}
      />
    </span>
  );
}

export function PaymentMethodCell({
  method,
  cardNetwork,
}: {
  method: string | null;
  cardNetwork: string | null;
}): React.JSX.Element {
  const kind = method?.toLowerCase();
  const network = cardNetwork?.toLowerCase();

  if (kind === 'upi') {
    return (
      <span className="ap-method-cell">
        <Mark src={upiLogo} cls="ap-method-logo--upi" />
        <span className="ap-method-label">UPI</span>
      </span>
    );
  }

  if (kind === 'netbanking') {
    return (
      <span className="ap-method-cell">
        <Mark src={netbankingLogo} cls="ap-method-logo--netbanking" />
        <span className="ap-method-label">Netbanking</span>
      </span>
    );
  }

  if (kind === 'wallet') {
    return (
      <span className="ap-method-cell">
        <span className="ap-method-logo-wrap">
          <Wallet size={15} color="oklch(0.5 0.015 280)" />
        </span>
        <span className="ap-method-label">Wallet</span>
      </span>
    );
  }

  // A card whose network was never reported still reads as a card, with the generic mark.
  const brand = network === undefined ? undefined : CARD_BRANDS[network];
  if (brand === undefined) {
    return (
      <span className="ap-method-cell">
        <span className="ap-method-logo-wrap">
          <CreditCard size={15} color="oklch(0.5 0.015 280)" />
        </span>
        <span className="ap-method-label">Card</span>
      </span>
    );
  }

  return (
    <span className="ap-method-cell">
      <Mark src={brand.logo} cls={brand.cls} />
      <span className="ap-method-label">{brand.label}</span>
    </span>
  );
}
