/**
 * Text input primitive.
 *
 * A native `<input>` in both themes — behaviour (value, selection, key events,
 * IME) is therefore identical; only paint moves. The command line's
 * `cmdline__input` and ~130 form inputs pass their own class through. `data-slot`
 * lets the shadcn theme give it a modern field treatment (ring on focus, radius)
 * under `[data-ui-theme='shadcn']`.
 */

import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

/** A native single-line `<input>` restyled by the shadcn theme; behaviour unchanged. */
export function TextInput({ type = 'text', className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input type={type} data-slot="input" className={cn(className)} {...rest} />;
}

/**
 * Multi-line variant, for the few `<textarea>`s (the text editor, some dialogs).
 */
export function TextArea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(className)} {...rest} />;
}
