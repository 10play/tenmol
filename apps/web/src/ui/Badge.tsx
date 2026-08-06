/**
 * Badge — a small status pill (todo markers, counts, "not installed" notes).
 * A styled `<span>`; the shadcn theme gives it a rounded token treatment.
 */

import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export function Badge({ className, ...rest }: ComponentPropsWithRef<'span'>) {
  return <span data-slot="badge" className={cn(className)} {...rest} />;
}
