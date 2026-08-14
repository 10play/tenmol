/**
 * The UI primitive layer — the app's design-system boundary.
 *
 * Import atoms from here (`import { Button, TextInput } from '../../ui'`) instead
 * of hand-writing `<button className="quickbutton">`. Every atom renders the
 * legacy BEM contract class so the classic look and the class-name-pinned tests
 * are unchanged; the shadcn look is a pure restyle keyed off `data-slot` (see
 * `styles/shadcn.css`) plus the Radix components below. Swap the whole look with
 * the {@link ThemeProvider} — nothing else moves.
 */

export { cn } from './cn';
export {
  ThemeProvider,
  useTheme,
  useThemeControls,
  type UiTheme,
  type ThemeControls,
} from './theme';

// Atoms — native/passthrough DOM, styled per theme by CSS.
export {
  Button,
  IconButton,
  ToggleButton,
  type ButtonVariant,
  type ButtonTone,
  type ButtonProps,
} from './Button';
export { Panel, PanelHeader, Toolbar } from './Panel';
export { FloatingWindow, type FloatingWindowProps, type WindowAnchor } from './FloatingWindow';
export { WINDOW_Z_FLOOR, nextWindowZ, topWindowZ } from './windowZ';
export { TextInput, TextArea } from './Input';
export { Badge } from './Badge';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { Select, Checkbox, Switch, Slider } from './Form';

// Radix-powered shadcn components — real modern components for new surfaces.
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuChevron,
} from './DropdownMenu';
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './Dialog';
export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './Tooltip';

// The live look-switcher control for the shell header.
export { ThemeToggle } from './ThemeToggle';
