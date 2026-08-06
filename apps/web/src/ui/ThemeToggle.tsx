/**
 * The live look-switcher — the control that makes "easily replaceable" concrete.
 *
 * It is itself a real shadcn/Radix `DropdownMenu` (the showcase interactive
 * component), with its trigger rendered as a shell-header `menubar__item` so it
 * sits with the other web-only chrome toggles. Picking an option flips the
 * {@link ThemeProvider} live — no reload, no state loss — and persists the
 * choice. With no provider mounted (unit tests) it degrades to a no-op button.
 */

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu';
import { useThemeControls, type UiTheme } from './theme';

const OPTIONS: ReadonlyArray<{ value: UiTheme; label: string }> = [
  { value: 'classic', label: 'Classic — PyMOL' },
  { value: 'shadcn', label: 'Modern — shadcn' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useThemeControls();
  return (
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
  );
}
