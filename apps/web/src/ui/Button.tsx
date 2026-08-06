/**
 * Button family — the most-reused atoms in the app.
 *
 * THE CONTRACT. Each button renders its legacy BEM class (chosen by `variant`)
 * plus whatever `className` the caller passes, and forwards every other prop
 * verbatim (`title`, `data-testid`, `aria-*`, `disabled`, `onClick`, `style`,
 * `ref`, children). The ~140 class-name-pinned tests read exactly those, so this
 * is a drop-in for the inline `<button className="quickbutton" …>` it replaces.
 *
 * THEME. The DOM is identical in both looks; the swap is pure CSS. We add
 * `data-slot` / `data-variant` (shadcn's own convention) so `styles/shadcn.css`
 * can restyle the button under `[data-ui-theme='shadcn']` without the classic
 * BEM rule ever changing. That is what keeps layout and behaviour identical
 * across the toggle: only paint moves.
 */

import type { ComponentPropsWithRef } from 'react';
import { cn } from './cn';

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

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'bare', type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      data-variant={variant}
      className={cn(VARIANT_CLASS[variant], className)}
      {...rest}
    />
  );
}

/**
 * A button whose content is a single glyph or icon. Identical to {@link Button}
 * except it advertises `data-slot="icon-button"` so the shadcn theme can size it
 * square and centre its content. The children (a `×`, a `|<`, a lucide icon) are
 * forwarded untouched — tests that read `textContent` keep working.
 */
export function IconButton({ variant = 'bare', type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="icon-button"
      data-variant={variant}
      className={cn(VARIANT_CLASS[variant], className)}
      {...rest}
    />
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
  ...rest
}: ToggleButtonProps) {
  return (
    <button
      type={type}
      data-slot="toggle-button"
      data-variant={variant}
      data-state={pressed ? 'on' : 'off'}
      aria-pressed={pressed}
      className={cn(VARIANT_CLASS[variant], pressed && 'is-on', className)}
      {...rest}
    />
  );
}
