'use client';

import StackedAccordion, {
  STACKED_OPEN_WIDTH, STACKED_CLOSED_WIDTH,
} from './sidebar/StackedAccordion';
import IconRail, {
  RAIL_OPEN_WIDTH, RAIL_CLOSED_WIDTH,
} from './sidebar/IconRail';
import FloatingPanel, {
  FLOAT_OPEN_WIDTH, FLOAT_CLOSED_WIDTH,
} from './sidebar/FloatingPanel';
import type { SidebarProps } from './sidebar/shared';

export type SidebarVariant = 'stacked' | 'rail' | 'floating';

export type { BrushState, BrushKind, BrushPattern, CopiedRegion } from './sidebar/shared';

export const SIDEBAR_VARIANTS: { id: SidebarVariant; name: string; hint: string }[] = [
  { id: 'stacked', name: 'Stacked', hint: 'Always-visible accordion sections, locked to left margin' },
  { id: 'rail', name: 'Rail', hint: 'VS-Code style: dark icon rail + flyout panel, one section at a time' },
  { id: 'floating', name: 'Floating', hint: 'Draggable card you can move anywhere; map keeps full width' },
];

/** Compute the px the page should pad its left side by, so the wizard
 *  doesn't slide under the toolbar. Floating variant returns 0 (it overlays
 *  the map without pushing). */
export function getSidebarOffset(variant: SidebarVariant, open: boolean): number {
  if (variant === 'stacked') return open ? STACKED_OPEN_WIDTH : STACKED_CLOSED_WIDTH;
  if (variant === 'rail') return open ? RAIL_OPEN_WIDTH : RAIL_CLOSED_WIDTH;
  if (variant === 'floating') return open ? FLOAT_OPEN_WIDTH : FLOAT_CLOSED_WIDTH;
  return 0;
}

interface DispatcherProps extends SidebarProps {
  variant: SidebarVariant;
}

export default function PlannerSidebar({ variant, ...rest }: DispatcherProps) {
  if (variant === 'rail') return <IconRail {...rest} />;
  if (variant === 'floating') return <FloatingPanel {...rest} />;
  return <StackedAccordion {...rest} />;
}

// Back-compat exports retained for callers that imported the old constants.
export const SIDEBAR_OPEN_WIDTH = STACKED_OPEN_WIDTH;
export const SIDEBAR_CLOSED_WIDTH = STACKED_CLOSED_WIDTH;
