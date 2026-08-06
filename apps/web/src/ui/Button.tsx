/**
 * Button family — the most-reused atoms in the app.
 *
 * THE CONTRACT. Each button renders its legacy BEM class (chosen by `variant`)
 * plus whatever `className` the caller passes, and forwards every other prop
 * verbatim (`title`, `data-testid`, `aria-*`, `disabled`, `onClick`, `style`,
 * `ref`, children). The ~140 class-name-pinned tests read exactly those, so this
 * is a drop-in for the inline `<button className="quickbutton" …>` it replaces.
 *
 * THEME + ICONS. Classic is text-only and byte-identical to today. In the shadcn
 * theme a button may show a lucide `icon` (passed by the call site); the text
 * label is ALWAYS kept in the DOM — rendered inline next to the icon, or
 * visually hidden (`iconOnly`) for media-style controls — so `textContent` is
 * unchanged and every test still passes in both themes. `data-slot` lets
 * `styles/shadcn.css` do the rest of the restyle.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { useTheme } from './theme';

export type ButtonVariant =
  'bare' | 'quick' | 'menubar' | 'control' | 'extgui' | 'launcher' | 'consoleBar' | 'op';

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

/**
 * Compose the button body. In classic (or with no icon) it is just `children`.
 * In shadcn with an icon it is the icon plus the label — inline, or visually
 * hidden when `iconOnly`. The label text stays in the DOM either way.
 */
function useButtonBody(
  icon: LucideIcon | undefined,
  iconOnly: boolean | undefined,
  children: ReactNode,
): { body: ReactNode; hasIcon: boolean } {
  const modern = useTheme() === 'shadcn';
  if (!modern || !icon) return { body: children, hasIcon: false };
  const Icon = icon;
  return {
    hasIcon: true,
    body: (
      <>
        <Icon className="ui-btn-icon" aria-hidden strokeWidth={1.75} />
        {iconOnly ? <span className="ui-sr">{children}</span> : children}
      </>
    ),
  };
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
  const { body, hasIcon } = useButtonBody(icon, iconOnly, children);
  return (
    <button
      type={type}
      data-slot="button"
      data-variant={variant}
      className={cn(VARIANT_CLASS[variant], hasIcon && 'ui-has-icon', className)}
      {...rest}
    >
      {body}
    </button>
  );
}

/**
 * A button whose content is a single glyph or icon. Defaults to `iconOnly`, so
 * in shadcn it renders just the lucide icon while the glyph text (`×`, `|<`)
 * stays in the DOM for tests. Advertises `data-slot="icon-button"`.
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
  const { body, hasIcon } = useButtonBody(icon, iconOnly, children);
  return (
    <button
      type={type}
      data-slot="icon-button"
      data-variant={variant}
      className={cn(VARIANT_CLASS[variant], hasIcon && 'ui-has-icon', className)}
      {...rest}
    >
      {body}
    </button>
  );
}

export interface ToggleButtonProps extends ButtonProps {
  /** Pressed state. Mirrored to `aria-pressed` and the legacy `is-on` token. */
  pressed?: boolean;
}

/**
 * A two-state button. The app expresses "on" with the `is-on` class and
 * `aria-pressed` (the overlay launcher, the ext-gui dock buttons); this keeps
 * both so nothing that queries them changes, and adds `data-state` for the
 * shadcn theme.
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
  const { body, hasIcon } = useButtonBody(icon, iconOnly, children);
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
        hasIcon && 'ui-has-icon',
        className,
      )}
      {...rest}
    >
      {body}
    </button>
  );
}
