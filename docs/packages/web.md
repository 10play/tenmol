---
title: "@tenmol/web"
description: "The PyMOL front-end: a React app that owns the window and nothing else. The renderer is @tenmol/viewport, the transport is @tenmol/client, the wire types…"
---

# @tenmol/web

The PyMOL front-end: a React app that owns the **window** and nothing else. The
renderer is `@tenmol/viewport`, the transport is `@tenmol/client`, the wire types
are `@tenmol/protocol`, the state is `@tenmol/stores`. Everything the user
actually interacts with is a _feature_, discovered from disk.

```bash
pnpm dev                              # bridge + vite together, from the repo root
pnpm --filter @tenmol/web dev         # vite only (needs a bridge already running)
pnpm --filter @tenmol/web typecheck
pnpm --filter @tenmol/web build       # tsc --noEmit, then vite build
```

## Shape

```
src/main.tsx        React root; StrictMode is ON
src/app/            the application layer — config, the session, context, hooks
src/shell/          the window: grid, gutter, status strip, overlays, slots
src/features/       25 declared slots, one directory each
src/styles/         global.css (every metric and colour cites its PyMOL source)
```

`src/app/App.tsx` is a provider wrapped around a shell —
`<BridgeProvider><AppShell/></BridgeProvider>` — and nothing else. It does not
change as features land, and that is the point.

**`src/app/session.ts` is a module singleton** — one socket, one set of stores,
one poll loop, created on first import. The product is "one PyMOL process, one
browser client", and a second connection would be a second consumer of a
destructive feedback drain. It is also what makes React 19 StrictMode's
double-mount a non-event. Features call `useSession()` and then `run` (a typed
command line, `{t:'do'}`), `act` (a UI action, `{t:'call'}`) or `call`; nothing
outside `src/app/` imports `@tenmol/client`.

`src/app/hooks.ts` is the React binding for `@tenmol/stores` — about thirty lines
of `useSyncExternalStore`, in place of a state library.

## The layout is PyMOL's, not a web app's

Qt PyMOL is a `QMainWindow` with the GL widget as the central widget and the
External GUI as a dock. Everything in the right-hand column — object panel,
wizard, mouse-mode block, movie controls — is **not Qt at all**: PyMOL draws it
inside the GL viewport as 2-D `Block`s stacked bottom-up by `OrthoLayoutPanel()`
(`packages/engine/layer1/Ortho.cpp`). Here those blocks are real DOM, in a column
of width `internal_gui_width` (default 220), pinned into `OrthoLayoutPanel`'s
order by CSS `order` because one of them is portalled in by another feature.

**The one value the shell writes to `internal_gui` is 0.** Measured: with
`internal_gui 1` and the default width, an 800x600 window reports a 580x600
scene, and every mouse coordinate the browser forwards is then wrong by 220 px.
The column is _our_ DOM; PyMOL's own copy must stay off. A non-zero value
arriving from PyMOL (someone typed `set internal_gui, 1`) turns our column on and
is pushed straight back to 0. `internal_gui_width` **is** written back as-is, so
a `.pse` and a headless `pymol -c` see the width the browser is showing.

The External GUI is docked at the **bottom** rather than Qt's default top,
because the in-viewport prompt and scrollback it duplicates are drawn at the
bottom of the scene. Its dockable/visible state machine (`shell/extGuiDock.ts`)
is a transcription of `toggle_ext_window_dockable`, Ctrl+E and all.

The status strip at the very bottom is the one deliberate addition: Qt PyMOL has
no status bar, but a desktop PyMOL never had a transport to report.

## Adding a feature

**Do not edit `src/features/registry.ts`.** Create
`src/features/<slot-id>/register.ts` with a default export of `FeatureModule` and
you are installed:

```ts
import type { FeatureModule } from '../registry';
export default { id: 'colors', Panel: ColorsPanel } satisfies FeatureModule;
```

Discovery is `import.meta.glob('./*/register.ts')`, so creating the directory is
the whole installation step and no shared file is edited. Loading is **lazy** on
purpose: an eager glob would make one feature's broken import a blank
application; lazily, a failure is confined to its slot and shown there by the
error boundary.

The registry declares 25 slots across six regions (`menubar`, `viewport`,
`internal-gui`, `external-gui`, `overlay`, `service`). **23 are installed**; the
two without a directory are `picking` (client-side picking lives in
`@tenmol/viewport/picking`, routed by `registerPickRoute`) and `plugins` (the
`plugin-manager` slot covers it). A declared slot with no directory renders its
`absent` note rather than a blank space — an unbuilt feature must be _visibly_
unbuilt. A directory no slot declares is reported through `UNDECLARED_FEATURES`
rather than silently ignored.

Three states are distinguishable in the DOM, which is what lets the e2e suite
assert on them: `.feature-failed` (threw, boundary caught it), `.feature-absent`
(no directory), anything else (mounted). A directory whose `register.ts` is
broken shows up as **absent**, which looks like unbuilt work — that is the
failure mode to watch for.

`src/features/mouse/` has no `register.ts` and is not a slot: it is a shared
table module other features import.

## Cross-feature calls go through `shell/panelHooks.ts`

A menu leaf in one feature has to open a dialog owned by another, and neither may
import the other. `panelHooks.ts` is the registry for that: a feature calls
`registerMenuHook('file_open', fn)` from its own directory and `MenuBar` merges
whatever is registered on top of what it implements itself, so a leaf goes live
the moment its owner lands.

Opening an overlay needs two steps, and the seam handles both: `openPanel(id)`
mounts the slot, and the _intent_ is queued against that mount — the slot is a
`React.lazy` behind a `Suspense`, so at the moment `openPanel` returns the module
has not been fetched and any event dispatched at it would land on nobody.
`FeatureSlot` reports the mount and the queue drains then.

## Two directories that are dead

`src/layout/` and `src/bridge/` are the wave-0 scaffold. **Nothing imports
them** — the live equivalents are `src/shell/` and `src/app/`. They still
typecheck and lint, so they cost nothing but confusion; do not extend them, and
do not take `src/layout/placeholderData.ts` as evidence that anything still
renders placeholder data.

## Dev-only query switches

Handled in `src/features/viewport/devFixtures.ts`:
`?viewportFixtures=<names>` (load pre-encoded geometry frames),
`?viewportHandle=1` (publish the live `ViewportHandle` on
`window.__tenmolViewport` — what the e2e suite measures), `?viewportPull=off`
(disable the dev PNG-pull fallback) and `?viewportModeP=off`. The fixture and
pull sources are inert in a production build because vite defines the frame
directory as empty there.

`?token=...` is consumed once by `src/app/config.ts`, stashed in `localStorage`
and then **stripped from the address bar** so it does not reach history or a
screenshot.

## Dependencies

`react`, `react-dom`, and the workspace packages `@tenmol/protocol`,
`@tenmol/client`, `@tenmol/stores`. No Tailwind, no component library, no state
manager.

`@tenmol/viewport` is deliberately **not** in `package.json`; vite resolves the
bare specifier through an alias in `vite.config.ts`. Because of that, deep
subpath imports (`@tenmol/viewport/input`, `@tenmol/viewport/picking`) do not
resolve from this app — the alias points at one file. Code that needs them uses a
relative path into `packages/viewport/src/`, and says so where it does. Adding
`"@tenmol/viewport": "workspace:*"` here and dropping the alias is the fix.

## Tests

```bash
$ node node_modules/vitest/vitest.mjs run apps/web
 Test Files  127 passed (127)
      Tests  1475 passed (1475)
```

Tests live next to the code they cover. A file named `*.dom.test.ts(x)` runs
under jsdom; everything else runs under node. That split is per _file_, not per
package, so no vitest config has to change when you add one.

Two stores are tested from here rather than from their own package —
`@tenmol/stores/console` and `@tenmol/stores/settings` — because their tests
exercise the store together with the feature that wires it.

The end-to-end suite is separate and documented in `e2e/README.md`.
