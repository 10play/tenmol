/**
 * Form controls — `Select`, `Checkbox`, `Switch`, `Slider`.
 *
 * These stay NATIVE elements in BOTH themes on purpose: a `<select>` /
 * `<input type=checkbox|range>` has value, keyboard, IME and event behaviour the
 * app already wires to `onChange` — reproducing it through Radix would be a
 * behaviour change, and "functionality identical" is the hard constraint. So the
 * shadcn look for these is pure CSS (appearance + accent-color + a switch track),
 * driven off `data-slot` under `[data-ui-theme='shadcn']`. Radix powers the
 * genuinely richer components instead (see `Dialog`, `DropdownMenu`, `Tooltip`).
 */

import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

/** A native `<select>` restyled by the shadcn theme; behaviour unchanged. */
export function Select({ className, ...rest }: ComponentPropsWithRef<'select'>) {
  return <select data-slot="select" className={cn(className)} {...rest} />;
}

/** A native checkbox `<input>` restyled by the shadcn theme; behaviour unchanged. */
export function Checkbox({ className, ...rest }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return <input type="checkbox" data-slot="checkbox" className={cn(className)} {...rest} />;
}

/** A checkbox presented as an on/off switch by the shadcn theme; native semantics. */
export function Switch({ className, ...rest }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return (
    <input type="checkbox" role="switch" data-slot="switch" className={cn(className)} {...rest} />
  );
}

/** A native range `<input>` restyled by the shadcn theme; behaviour unchanged. */
export function Slider({ className, ...rest }: Omit<ComponentPropsWithRef<'input'>, 'type'>) {
  return <input type="range" data-slot="slider" className={cn(className)} {...rest} />;
}
