import type { ReactNode } from 'react';
import {
  CreditCard,
  SquaresFour,
  WarningCircle,
  Brain,
  Bell,
  ClipboardText,
  MagnifyingGlass,
  PlayCircle,
  Gear,
  Storefront,
  List,
  Shield,
  SignOut,
  ArrowSquareOut,
} from '@phosphor-icons/react';

import type { ElementType } from 'react';

const PATHS: Record<string, ElementType> = {
  attempts: CreditCard,
  overview: SquaresFour,
  incidents: WarningCircle,
  model: Brain,
  bell: Bell,
  policies: ClipboardText,
  audit: MagnifyingGlass,
  simulation: PlayCircle,
  settings: Gear,
  store: Storefront,
  menu: List,
  shield: Shield,
  logout: SignOut,
  external: ArrowSquareOut,
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}): React.JSX.Element | null {
  const Component = PATHS[name];
  if (!Component) return null;
  return <Component size={size} className={className} />;
}

export type IconName = keyof typeof PATHS;
