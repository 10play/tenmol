/**
 * Tooltip — a real shadcn/Radix tooltip, offered as a primitive.
 *
 * The app expresses hover help with the native `title` attribute, which the
 * tests read; those stay. This is here for surfaces that want a richer tooltip.
 */

import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

/** Shares tooltip timing/state across a subtree; wrap the app (or a region) once. */
export const TooltipProvider = RadixTooltip.Provider;
/** Root of a single tooltip; pairs a {@link TooltipTrigger} with {@link TooltipContent}. */
export const Tooltip = RadixTooltip.Root;
/** The element that shows the tooltip on hover/focus. */
export const TooltipTrigger = RadixTooltip.Trigger;

/** The floating tooltip bubble. */
export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithRef<typeof RadixTooltip.Content>) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-[90] rounded-lg border border-white/10 bg-pm-panel/90 px-2.5 py-1.5 backdrop-blur-xl',
          'font-sans text-[11px] text-pm-text shadow-xl shadow-black/60',
          className,
        )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
