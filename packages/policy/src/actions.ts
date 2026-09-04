/**
 * The five things this system may do, and what each costs the person on the other end.
 *
 * Every one of them is **reversible** and every one of them **expires**. Those are not
 * properties of the current list — they are the constraint the list was written under, and an
 * action that could be neither would not be added. The failure mode of a permanent block is a
 * customer who can never pay again while nothing appears to have gone wrong; the failure mode of
 * an irreversible one is that a mistake cannot be undone once understood.
 */

export type Action = 'observe' | 'step_up' | 'contain' | 'escalate' | 'release';

/** How much the shopper notices. What the degradation matrix and the approval gate key on. */
export type Impact = 'none' | 'visible' | 'blocking';

export interface ActionShape {
  action: Action;
  impact: Impact;
  /** Whether undoing it restores the shopper to where they were. Always true, and checked. */
  reversible: boolean;
  /** Whether it must carry an expiry. Anything the shopper notices does. */
  expires: boolean;
  /** One-line description, in the terms a person affected by it would use. */
  describes: string;
}

export const ACTIONS: Record<Action, ActionShape> = {
  observe: {
    action: 'observe',
    impact: 'none',
    reversible: true,
    expires: false,
    describes: 'Watch it. Nothing changes for anyone paying.',
  },
  step_up: {
    action: 'step_up',
    impact: 'visible',
    reversible: true,
    expires: true,
    describes: 'Ask for another factor before allowing the payment. Slower, never refused.',
  },
  contain: {
    action: 'contain',
    impact: 'blocking',
    reversible: true,
    expires: true,
    describes: 'Refuse further attempts from this entity until it expires.',
  },
  escalate: {
    action: 'escalate',
    impact: 'none',
    reversible: true,
    expires: false,
    describes: 'Put it in front of a person. Nothing changes for anyone paying.',
  },
  release: {
    action: 'release',
    impact: 'none',
    reversible: true,
    expires: false,
    describes: 'Lift a containment early.',
  },
};

/** Actions the shopper would notice, which is the set the safety rules are written about. */
export const CUSTOMER_IMPACTING: readonly Action[] = ['step_up', 'contain'];

export const isCustomerImpacting = (action: Action): boolean => CUSTOMER_IMPACTING.includes(action);
