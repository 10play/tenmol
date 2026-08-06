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

export function Panel({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div data-slot="panel" className={cn(className)} {...rest} />;
}

export function PanelHeader({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div data-slot="panel-header" className={cn(className)} {...rest} />;
}

export interface ToolbarProps extends ComponentPropsWithRef<'div'> {
  /** Defaults to `toolbar` — the role the launcher/quick-button rows already use. */
  role?: string;
}

export function Toolbar({ className, role = 'toolbar', ...rest }: ToolbarProps) {
  return <div data-slot="toolbar" role={role} className={cn(className)} {...rest} />;
}
