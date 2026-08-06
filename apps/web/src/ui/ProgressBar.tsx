/**
 * Progress bar.
 *
 * A faithful drop-in for the quick-button progress row: it renders the
 * `progressbar` / `progressbar__fill` classes, the `role="progressbar"` + aria
 * range, and the inline `style.width` the test reads (`'35%'`). The percentage
 * is normalised from `value` against `[min,max]`, which for the existing
 * `value = int(get_progress()*100)`, `max = 100` case is `value%` exactly.
 */

import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

export interface ProgressBarProps extends Omit<ComponentPropsWithRef<'div'>, 'role'> {
  value: number;
  min?: number;
  max?: number;
  /** Extra class for the inner fill element. */
  fillClassName?: string;
}

export function ProgressBar({
  value,
  min = 0,
  max = 100,
  className,
  fillClassName,
  ...rest
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div
      data-slot="progress"
      className={cn('progressbar', className)}
      role="progressbar"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      {...rest}
    >
      <div
        data-slot="progress-fill"
        className={cn('progressbar__fill', fillClassName)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
