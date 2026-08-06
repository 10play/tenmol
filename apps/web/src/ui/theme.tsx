/**
 * The theme seam — the one switch that makes the whole UI replaceable.
 *
 * Two looks ship at once. `classic` is the pixel-exact PyMOL reproduction the
 * app has always had; `shadcn` is the modern reskin. Every primitive in
 * `src/ui/` reads {@link useTheme} and renders one or the other, so swapping the
 * entire look is this context's value — nothing else moves.
 *
 * TWO PROPERTIES THIS FILE GUARANTEES, both load-bearing:
 *
 *   1. With NO provider mounted, `useTheme()` returns `'classic'` (the context
 *      default). Every existing DOM test renders primitives with no provider and
 *      therefore exercises the classic passthrough DOM — which is why the ~140
 *      class-name-pinned tests need no edits.
 *
 *   2. Resolution precedence is URL param > localStorage > `'classic'`. The
 *      `?theme=` param exists so a screenshot / e2e run can pin either look
 *      without clicking; localStorage makes a user's choice stick across reloads.
 *
 * State lives here, NOT in `@tenmol/stores`' UI store, on purpose: the whole
 * `src/ui/` layer stays portable (it depends on nothing but React), which is the
 * point of an abstraction that is meant to be lifted out and replaced.
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

export type UiTheme = 'classic' | 'shadcn';

const STORAGE_KEY = 'tenmol.ui.theme';

function isTheme(value: unknown): value is UiTheme {
  return value === 'classic' || value === 'shadcn';
}

/** URL param > localStorage > 'classic'. Every read is defensive: a headless or
 * storage-disabled context must fall back, never throw. */
function readInitialTheme(): UiTheme {
  try {
    const search = globalThis.location?.search ?? '';
    const param = new URLSearchParams(search).get('theme');
    if (isTheme(param)) return param;
  } catch {
    /* no location (node) */
  }
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* storage disabled by policy */
  }
  return 'classic';
}

function persistTheme(theme: UiTheme): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    /* quota / private mode: the choice simply will not stick */
  }
}

export interface ThemeControls {
  theme: UiTheme;
  setTheme: (theme: UiTheme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeControls>({
  theme: 'classic',
  setTheme: () => undefined,
  toggle: () => undefined,
});

export function ThemeProvider({
  children,
  theme: forced,
}: {
  children: ReactNode;
  /** Pin the theme (tests, a second window). Overrides URL/storage resolution. */
  theme?: UiTheme;
}) {
  const [theme, setThemeState] = useState<UiTheme>(() => forced ?? readInitialTheme());

  useEffect(() => {
    if (forced && forced !== theme) setThemeState(forced);
  }, [forced, theme]);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next: UiTheme = current === 'classic' ? 'shadcn' : 'classic';
      persistTheme(next);
      return next;
    });
  }, []);

  // Stamp the root so CSS (shadcn tokens, any `[data-ui-theme]` hook) can see the
  // active look. Harmless in tests: without a provider nothing stamps.
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (root) root.setAttribute('data-ui-theme', theme);
  }, [theme]);

  const value = useMemo<ThemeControls>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme. `'classic'` when no provider is mounted. */
export function useTheme(): UiTheme {
  return useContext(ThemeContext).theme;
}

/** The theme plus its setters, for the toggle control. */
export function useThemeControls(): ThemeControls {
  return useContext(ThemeContext);
}
