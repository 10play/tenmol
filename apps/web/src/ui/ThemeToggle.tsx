/**
 * The live look-switcher — the control that makes "easily replaceable" concrete.
 *
 * A real shadcn/Radix `DropdownMenu` (classic ⇄ modern), with its trigger
 * rendered as a shell-header `menubar__item`. When the modern theme is active it
 * also shows a Sun/Moon button that flips light/dark. Both persist and flip the
 * {@link ThemeProvider} live — no reload. With no provider mounted (unit tests)
 * they degrade to inert buttons.
 */

import { Moon, Sun } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu';
import { IconButton } from './Button';
import { useThemeControls, type UiTheme } from './theme';

const OPTIONS: ReadonlyArray<{ value: UiTheme; label: string }> = [
  { value: 'classic', label: 'Classic — PyMOL' },
  { value: 'shadcn', label: 'Modern — shadcn' },
];

/** Shell control to switch theme (classic/shadcn) and, in the modern theme, light/dark. */
export function ThemeToggle() {
  const { theme, setTheme, appearance, toggleAppearance } = useThemeControls();
  return (
    <>
      {theme === 'shadcn' && (
        <IconButton
          variant="menubar"
          icon={appearance === 'dark' ? Sun : Moon}
          data-testid="appearance-toggle"
          title={appearance === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={toggleAppearance}
        >
          {appearance === 'dark' ? 'light' : 'dark'}
        </IconButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="menubar__item"
            data-testid="theme-toggle"
            title="Switch the UI theme — classic PyMOL ↔ modern shadcn"
          >
            ◐ {theme === 'shadcn' ? 'modern' : 'classic'}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>UI theme</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {OPTIONS.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={theme === option.value}
              onCheckedChange={() => setTheme(option.value)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
