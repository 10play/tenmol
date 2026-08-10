/**
 * Surface primitives — `Panel`, `PanelHeader`, `Toolbar`.
 *
 * Structural containers, styled by CSS per theme. Each forwards `className` and
 * every other prop, so a feature can pass its own positioning/root class (the
 * overlay panels bring their own `position: absolute` — the launcher decides
 * WHETHER a panel renders, the panel decides WHERE). The `data-slot` hook lets
 * the shadcn theme give panels a card treatment (border, radius, shadow)
 * without touching the classic BEM rules.
 */

import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

/** A surface container; the shadcn theme gives it a frosted card treatment. */
export function Panel({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return (
    <div
      data-slot="panel"
      className={cn(
        'modern:rounded-[8px] modern:border modern:border-line-strong modern:shadow-[var(--sh-pop)] modern:bg-[var(--sh-panel-frost)] modern:[backdrop-filter:var(--sh-blur)]',
        className,
      )}
      {...rest}
    />
  );
}

/** The header strip of a {@link Panel}. */
export function PanelHeader({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div data-slot="panel-header" className={cn(className)} {...rest} />;
}

/** Props for {@link Toolbar}: div props with an overridable ARIA `role`. */
export interface ToolbarProps extends ComponentPropsWithRef<'div'> {
  /** Defaults to `toolbar` — the role the launcher/quick-button rows already use. */
  role?: string;
}

/** A horizontal band of controls (`role="toolbar"` by default). */
export function Toolbar({ className, role = 'toolbar', ...rest }: ToolbarProps) {
  return <div data-slot="toolbar" role={role} className={cn(className)} {...rest} />;
}
