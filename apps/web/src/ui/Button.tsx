/**
 * Button family — the most-reused atoms in the app.
 *
 * THE CONTRACT. Each button renders its legacy BEM class (chosen by `variant`)
 * plus whatever `className` the caller passes, and forwards every other prop
 * verbatim (`title`, `data-testid`, `aria-*`, `disabled`, `onClick`, `style`,
 * `ref`, children). The ~140 class-name-pinned tests read exactly those.
 *
 * MODERN THEME = TAILWIND. In the shadcn theme the button also gets a set of
 * Tailwind utility classes (`MODERN_VARIANT`). Those WIN over the classic BEM
 * rule because the classic stylesheets live in the low `legacy` cascade layer
 * (see styles/legacy.css) while Tailwind utilities live in `@layer utilities`.
 * So classic is styled by CSS, modern by Tailwind, from the SAME DOM — and since
 * the utilities are only added under the modern theme, classic is untouched and
 * every class-name test still passes.
 *
 * ICONS. A lucide `icon` renders in the modern theme only; the text label is
 * always kept in the DOM (inline, or visually hidden for `iconOnly`), so
 * `textContent` is unchanged.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { useTheme } from './theme';

export type ButtonVariant =
  | 'bare'
  | 'quick'
  | 'menubar'
  | 'control'
  | 'extgui'
  | 'launcher'
  | 'consoleBar'
  | 'op';

/** variant → the legacy BEM base class it stands in for. */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  bare: '',
  quick: 'quickbutton',
  menubar: 'menubar__item',
  control: 'control__btn',
  extgui: 'extgui__btn',
  launcher: 'overlay-launcher__btn',
  consoleBar: 'console__bar-btn',
  op: 'objrow__op',
};

/* The one button system, in Tailwind. `flat` = bordered fill; `ghost` = text
 * that fills on hover. `on`/`off` state is added by ToggleButton via data-state. */
const FLAT =
  'inline-flex items-center justify-center gap-1.5 rounded-[6px] border font-medium leading-none ' +
  'border-[var(--sh-btn-border)] bg-[var(--sh-btn-fill)] text-[var(--pm-text)] transition-colors ' +
  'hover:border-[var(--sh-btn-border-strong)] hover:bg-[var(--sh-btn-hover)] hover:text-[var(--pm-text-bright)] ' +
  'active:opacity-90 disabled:opacity-45 disabled:pointer-events-none';
const GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium leading-none ' +
  'text-[var(--pm-text-dim)] transition-colors hover:bg-[var(--sh-btn-hover)] hover:text-[var(--pm-text-bright)] ' +
  'disabled:opacity-45 disabled:pointer-events-none';

const MODERN_VARIANT: Record<ButtonVariant, string> = {
  bare: `${FLAT} h-7 px-3 text-[12px]`,
  quick: `${FLAT} h-6 px-[11px] text-[11.5px]`,
  menubar: `${GHOST} px-2.5 py-1 text-[12px] text-[var(--pm-text-dim)]`,
  control: `${GHOST} rounded p-1`,
  extgui: `${FLAT} h-6 px-2 text-[11px]`,
  launcher: `${GHOST} rounded-full px-3 py-[5px] text-[11px]`,
  consoleBar: `${FLAT} h-[22px] px-2.5 text-[11px]`,
  op: '',
};

interface IconProps {
  /** A lucide icon shown ONLY in the shadcn theme (classic stays text-only).
   * Explicit `| undefined` so an optional data field can be forwarded directly
   * under `exactOptionalPropertyTypes`. */
  icon?: LucideIcon | undefined;
  /** With an icon, hide the text label (kept in the DOM for a11y + tests). */
  iconOnly?: boolean | undefined;
}

export interface ButtonProps extends ComponentPropsWithRef<'button'>, IconProps {
  variant?: ButtonVariant;
}

/** Icon + label body; label text always stays in the DOM. */
function body(
  modern: boolean,
  icon: LucideIcon | undefined,
  iconOnly: boolean | undefined,
  children: ReactNode,
): ReactNode {
  if (!modern || !icon) return children;
  const Icon = icon;
  return (
    <>
      <Icon className="ui-btn-icon" aria-hidden strokeWidth={1.75} />
      {iconOnly ? <span className="ui-sr">{children}</span> : children}
    </>
  );
}

export function Button({
  variant = 'bare',
  type = 'button',
  className,
  icon,
  iconOnly,
  children,
  ...rest
}: ButtonProps) {
  const modern = useTheme() === 'shadcn';
  return (
    <button
      type={type}
      data-slot="button"
      data-variant={variant}
      className={cn(VARIANT_CLASS[variant], modern && MODERN_VARIANT[variant], className)}
      {...rest}
    >
      {body(modern, icon, iconOnly, children)}
    </button>
  );
}

/**
 * A button whose content is a single glyph or icon; defaults to `iconOnly`.
 * Square in the modern theme.
 */
export function IconButton({
  variant = 'bare',
  type = 'button',
  className,
  icon,
  iconOnly = true,
  children,
  ...rest
}: ButtonProps) {
  const modern = useTheme() === 'shadcn';
  return (
    <button
      type={type}
      data-slot="icon-button"
      data-variant={variant}
      className={cn(
        VARIANT_CLASS[variant],
        modern && MODERN_VARIANT[variant],
        modern && icon && iconOnly && 'aspect-square px-0',
        className,
      )}
      {...rest}
    >
      {body(modern, icon, iconOnly, children)}
    </button>
  );
}

export interface ToggleButtonProps extends ButtonProps {
  /** Pressed state. Mirrored to `aria-pressed` and the legacy `is-on` token. */
  pressed?: boolean;
}

/**
 * A two-state button. Keeps the legacy `is-on` class + `aria-pressed`; in the
 * modern theme the accent "on" fill is Tailwind, keyed off `data-state`.
 */
export function ToggleButton({
  variant = 'bare',
  pressed = false,
  type = 'button',
  className,
  icon,
  iconOnly,
  children,
  ...rest
}: ToggleButtonProps) {
  const modern = useTheme() === 'shadcn';
  return (
    <button
      type={type}
      data-slot="toggle-button"
      data-variant={variant}
      data-state={pressed ? 'on' : 'off'}
      aria-pressed={pressed}
      className={cn(
        VARIANT_CLASS[variant],
        pressed && 'is-on',
        modern && MODERN_VARIANT[variant],
        modern &&
          'data-[state=on]:border-transparent data-[state=on]:bg-[var(--pm-accent)] data-[state=on]:text-[var(--sh-accent-text)] data-[state=on]:hover:bg-[var(--pm-accent)]',
        className,
      )}
      {...rest}
    >
      {body(modern, icon, iconOnly, children)}
    </button>
  );
}
