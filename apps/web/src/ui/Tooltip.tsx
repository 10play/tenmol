/**
 * Tooltip — a real shadcn/Radix tooltip, offered as a primitive.
 *
 * The app expresses hover help with the native `title` attribute, which the
 * tests read; those stay. This is here for surfaces that want a richer tooltip.
 */

import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

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
          'z-[90] rounded-md border border-pm-line bg-pm-panel px-2 py-1',
          'font-sans text-[11px] text-pm-text shadow-md shadow-black/50',
          className,
        )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}
