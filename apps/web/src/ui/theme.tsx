/**
 * The theme seam — the one switch that makes the whole UI replaceable.
 *
 * Two axes, orthogonal on purpose:
 *   - THEME    `classic` | `shadcn`  — the pixel-exact PyMOL look vs the modern
 *              reskin. Stamped as `data-ui-theme` on <html>.
 *   - APPEARANCE `dark` | `light`    — only meaningful for the modern theme,
 *              which redefines its ~24 design tokens for light mode. Stamped as
 *              `data-appearance`. Classic never reads these tokens, so it is
 *              unaffected. The 3D viewport and the console deliberately stay dark
 *              in both appearances.
 *
 * Every `src/ui` primitive reads {@link useTheme}; swapping the whole look is
 * this context's value — nothing else moves.
 *
 * TWO PROPERTIES THIS FILE GUARANTEES, both load-bearing:
 *   1. With NO provider mounted, `useTheme()` returns `'classic'` (the context
 *      default). Every existing DOM test renders primitives with no provider and
 *      therefore exercises the classic passthrough DOM — which is why the ~140
 *      class-name-pinned tests need no edits.
 *   2. Resolution precedence: URL param > localStorage > (appearance also falls
 *      back to `prefers-color-scheme`) > default. `?theme=` / `?appearance=`
 *      exist so a screenshot / e2e run can pin either without clicking.
 *
 * State lives here, NOT in `@tenmol/stores`, so the whole `src/ui` layer stays
 * portable — the point of an abstraction meant to be lifted out and replaced.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** The look-and-feel axis: the pixel-exact `classic` PyMOL UI or the modern `shadcn` theme. */
export type UiTheme = 'classic' | 'shadcn';
/** The light/dark axis, independent of {@link UiTheme}. */
export type UiAppearance = 'dark' | 'light';

const THEME_KEY = 'tenmol.ui.theme';
const APPEARANCE_KEY = 'tenmol.ui.appearance';

function isTheme(value: unknown): value is UiTheme {
  return value === 'classic' || value === 'shadcn';
}
function isAppearance(value: unknown): value is UiAppearance {
  return value === 'dark' || value === 'light';
}

function param(name: string): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get(name);
  } catch {
    return null;
  }
}
function stored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function persist(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* quota / private mode: the choice simply will not stick */
  }
}

/** URL param > localStorage > 'classic'. */
function readInitialTheme(): UiTheme {
  const p = param('theme');
  if (isTheme(p)) return p;
  const s = stored(THEME_KEY);
  return isTheme(s) ? s : 'classic';
}

/** URL param > localStorage > prefers-color-scheme > 'dark'. */
function readInitialAppearance(): UiAppearance {
  const p = param('appearance');
  if (isAppearance(p)) return p;
  const s = stored(APPEARANCE_KEY);
  if (isAppearance(s)) return s;
  try {
    if (globalThis.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    /* no matchMedia */
  }
  return 'dark';
}

/** The current theme + appearance and the setters/togglers exposed by {@link useThemeControls}. */
export interface ThemeControls {
  theme: UiTheme;
  appearance: UiAppearance;
  setTheme: (theme: UiTheme) => void;
  toggle: () => void;
  setAppearance: (appearance: UiAppearance) => void;
  toggleAppearance: () => void;
}

const ThemeContext = createContext<ThemeControls>({
  theme: 'classic',
  appearance: 'dark',
  setTheme: () => undefined,
  toggle: () => undefined,
  setAppearance: () => undefined,
  toggleAppearance: () => undefined,
});

/**
 * Resolves theme + appearance (URL param > localStorage > system > default),
 * stamps `data-ui-theme`/`data-appearance` on `<html>`, and provides
 * {@link ThemeControls} to the tree.
 */
export function ThemeProvider({
  children,
  theme: forced,
}: {
  children: ReactNode;
  /** Pin the theme (tests, a second window). Overrides URL/storage resolution. */
  theme?: UiTheme;
}) {
  const [theme, setThemeState] = useState<UiTheme>(() => forced ?? readInitialTheme());
  const [appearance, setAppearanceState] = useState<UiAppearance>(() => readInitialAppearance());

  useEffect(() => {
    if (forced && forced !== theme) setThemeState(forced);
  }, [forced, theme]);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    persist(THEME_KEY, next);
  }, []);
  const toggle = useCallback(() => {
    setThemeState((cur) => {
      const next: UiTheme = cur === 'classic' ? 'shadcn' : 'classic';
      persist(THEME_KEY, next);
      return next;
    });
  }, []);
  const setAppearance = useCallback((next: UiAppearance) => {
    setAppearanceState(next);
    persist(APPEARANCE_KEY, next);
  }, []);
  const toggleAppearance = useCallback(() => {
    setAppearanceState((cur) => {
      const next: UiAppearance = cur === 'dark' ? 'light' : 'dark';
      persist(APPEARANCE_KEY, next);
      return next;
    });
  }, []);

  // Stamp the root so the theme CSS can hook the active look + appearance.
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (root) root.setAttribute('data-ui-theme', theme);
  }, [theme]);
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (root) root.setAttribute('data-appearance', appearance);
  }, [appearance]);

  const value = useMemo<ThemeControls>(
    () => ({ theme, appearance, setTheme, toggle, setAppearance, toggleAppearance }),
    [theme, appearance, setTheme, toggle, setAppearance, toggleAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme. `'classic'` when no provider is mounted. */
export function useTheme(): UiTheme {
  return useContext(ThemeContext).theme;
}

/** The theme + appearance plus their setters, for the toggle controls. */
export function useThemeControls(): ThemeControls {
  return useContext(ThemeContext);
}
