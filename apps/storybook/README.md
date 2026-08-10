# @tenmol/storybook

A Storybook workbench for the tenmol web client's **UI primitive layer**
(`apps/web/src/ui`) and the bundles composed from it — in both the **classic
(PyMOL)** and **modern (shadcn)** themes, light and dark.

The components are consumed as TypeScript **source** through the `@web/*` alias
(the same way `apps/web` consumes them via Vite), so a story always shows exactly
what the app renders — there is no separate build of the UI to drift.

## Run it

```bash
# from the repo root
corepack pnpm --filter @tenmol/storybook storybook   # dev server on :6011
corepack pnpm --filter @tenmol/storybook build        # static build -> storybook-static/
corepack pnpm --filter @tenmol/storybook typecheck
```

## The theme toolbar

Two toolbar controls drive the two axes the app itself exposes, and every story
re-renders in the chosen combination:

| Control    | Values                                | Notes                              |
| ---------- | ------------------------------------- | ---------------------------------- |
| Theme      | `Classic — PyMOL` / `Modern — shadcn` | The whole look; same DOM.          |
| Appearance | `Dark` / `Light`                      | Modern theme only; classic ignores.|

## How it hangs together

- `.storybook/storybook.css` re-loads the app's exact CSS pipeline
  (`legacy.css` → `tailwind.css` → `shadcn.css`) and adds two `@source` globs so
  Tailwind generates the modern utility classes that live in `apps/web/src/ui`.
- `.storybook/decorators.tsx` mounts the real `ThemeProvider` (driven by the
  toolbar) and a **stub `Session`** — real stores from `@tenmol/stores`, an inert
  command surface — so feature bundles render without a PyMOL bridge.
- `.storybook/preview.tsx` wires the toolbar globals and the decorators.

## Adding a story

Copy `stories/primitives/Button.stories.tsx` as the template: CSF3, import
primitives from `@web/ui`, cover each state as its own named story, and let the
toolbar handle theme/appearance — never wrap a story in a provider yourself.
