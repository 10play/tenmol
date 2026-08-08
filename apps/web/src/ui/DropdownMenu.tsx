/**
 * DropdownMenu — a real shadcn/Radix component.
 *
 * Unlike the atoms (which stay native so behaviour never changes), this is a
 * genuine Radix menu with the modern shadcn treatment, used for NEW controls
 * (the theme switcher in the shell header). It is deliberately NOT wired into
 * the app's existing bespoke menus (`features/menubar`, `features/pymol-menu`),
 * whose hand-rolled DOM the class-name tests pin — those stay as they are and
 * get restyled by `styles/shadcn.css`.
 *
 * Styled with the bridged Tailwind tokens (`bg-pm-panel`, `border-pm-line`, …)
 * so it tracks `global.css`. Rendered in a portal at the document root, under
 * `[data-ui-theme]`, so the theme is always an ancestor.
 */

import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

/** Root of a Radix dropdown menu. */
export const DropdownMenu = RadixDropdownMenu.Root;
/** The control that opens the {@link DropdownMenu}. */
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger;
/** Groups related {@link DropdownMenuItem}s for accessibility. */
export const DropdownMenuGroup = RadixDropdownMenu.Group;

/** The portalled, floating menu surface. */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Content>) {
  return (
    <RadixDropdownMenu.Portal>
      <RadixDropdownMenu.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-[70] min-w-[12rem] overflow-hidden rounded-[10px] border border-white/10 p-1.5',
          'bg-pm-panel/85 backdrop-blur-2xl backdrop-saturate-150',
          'font-sans text-[12px] text-pm-text shadow-2xl shadow-black/60',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      />
    </RadixDropdownMenu.Portal>
  );
}

/** A selectable menu row. */
export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Item>) {
  return (
    <RadixDropdownMenu.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5',
        'outline-none data-[highlighted]:bg-pm-accent data-[highlighted]:text-white',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** A menu row with a checkmark indicator for a toggled option. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentPropsWithRef<typeof RadixDropdownMenu.CheckboxItem>) {
  return (
    <RadixDropdownMenu.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2.5',
        'outline-none data-[highlighted]:bg-pm-accent data-[highlighted]:text-white',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <RadixDropdownMenu.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </RadixDropdownMenu.ItemIndicator>
      </span>
      {children}
    </RadixDropdownMenu.CheckboxItem>
  );
}

/** A non-interactive section heading within the menu. */
export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Label>) {
  return (
    <RadixDropdownMenu.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2 py-1.5 text-[11px] uppercase tracking-wide text-pm-text-dim', className)}
      {...props}
    />
  );
}

/** A horizontal rule separating groups of menu rows. */
export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithRef<typeof RadixDropdownMenu.Separator>) {
  return (
    <RadixDropdownMenu.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-pm-line', className)}
      {...props}
    />
  );
}

/** Right-chevron affordance for submenu triggers, exported for convenience. */
export function DropdownMenuChevron() {
  return <ChevronRight className="ml-auto h-3.5 w-3.5" />;
}
