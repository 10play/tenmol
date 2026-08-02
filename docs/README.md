# tenmol web client — docs index

This directory holds the design record for replacing PyMOL's Qt front-end with a React web app,
while keeping the PyMOL C++/Python engine in this repository unchanged.

**Deployment model:** local desktop replacement. One PyMOL process, one browser client, on
`localhost`, with full filesystem access. Not a multi-tenant server.

## Read in this order

| Doc                                                            | What it is                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`02-completeness-critique.md`](./02-completeness-critique.md) | **Read first.** Adversarial review of the two synthesis docs. 8 blockers (A1–A8), 9 majors, 6 minors, all cited to `file:line`. |
| [`00-parity-inventory.md`](./00-parity-inventory.md)           | 351 feature rows — the definition of done. Every Qt-GUI affordance, its source, and the backend symbol behind it.               |
| [`01-architecture.md`](./01-architecture.md)                   | Proposed monorepo, wire protocol, work-package split. Note: §6 predates this root tooling — see "Deviations" below.             |
| [`spikes/00-build.md`](./spikes/00-build.md)                   | Executed build spike (macOS arm64). PyMOL 3.2.0a0 builds and imports headless. §6 has three findings that constrain the bridge. |

## Area maps

Each map is a grounded inventory of one Qt/Tk surface, produced before the synthesis docs.

- [`qt-main-window.md`](./qt-main-window.md) — `pmg_qt` main window, menus, docks, toolbars
- [`internal-gui.md`](./internal-gui.md) — the OpenGL-drawn internal GUI (Ortho, object panel, popups)
- [`input-mouse-keyboard.md`](./input-mouse-keyboard.md) — mouse modes, ButMode, key bindings
- [`cmd-api-rpc.md`](./cmd-api-rpc.md) — the `cmd` API surface and how to call it over a wire
- [`geometry-extraction.md`](./geometry-extraction.md) — getting renderable geometry out of the engine
- [`settings-colors.md`](./settings-colors.md) — settings tree, setting updates, color/ramp machinery
- [`movies-scenes-states.md`](./movies-scenes-states.md) — movie panel, scenes, states, frames
- [`dialogs-volume-properties-scenes.md`](./dialogs-volume-properties-scenes.md) — modal dialogs, volume panel, property editor
- [`builder.md`](./builder.md) — the molecular builder / editor
- [`wizards.md`](./wizards.md) — the wizard framework and every bundled wizard
- [`file-io.md`](./file-io.md) — load/save/export filters, recent files, file dialogs
- [`build-and-tooling.md`](./build-and-tooling.md) — how PyMOL builds, and what the JS toolchain must do

## Repository layout

```
tenmol/
├─ packages/engine/layer0/ … packages/engine/layer5/  packages/engine/modules/  packages/engine/data/  packages/engine/ov/  setup.py   # upstream PyMOL — do not modify
├─ apps/web/                                           # @tenmol/web — the React app (Vite)
├─ packages/                                           # @tenmol/protocol, client, ui, viewport
├─ packages/bridge/                                             # Python bridge process (PyMOL side)
├─ scripts/dev-bridge.sh                               # starts the bridge for `pnpm dev`
└─ docs/                                     # this directory
```

Root tooling (owned here): `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.npmrc`,
`.prettierrc`, `eslint.config.js`.

## Running the stack

Requirements: **Node ≥ 22**, **pnpm 9** (`packageManager` pins `pnpm@9.15.4`), and a Python
interpreter with this tree's PyMOL installed into it (see `spikes/00-build.md` §3–4 for the exact
build that was verified on macOS arm64).

```bash
pnpm install          # once, from the repo root
pnpm dev              # bridge + web app together (concurrently, --kill-others)
```

`pnpm dev` runs two processes:

| Process  | Command                         | Notes                                                                              |
| -------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `bridge` | `bash scripts/dev-bridge.sh`    | Python; owns the single PyMOL process. Serves `ws://127.0.0.1:8765/ws` by default. |
| `web`    | `pnpm --filter @tenmol/web dev` | Vite dev server, `http://localhost:5173`.                                          |

`scripts/dev-bridge.sh` is owned by the bridge package, takes any `python -m tenmol_bridge` flag,
and looks for its interpreter in `$TENMOL_VENV`, then `packages/bridge/.venv`, then `.venv`. Build PyMOL
into that venv first.

Either process exiting tears down the other (`--kill-others`), so you never debug a UI talking to
a dead engine. Ctrl-C tears down both. To run just one side: `pnpm dev:bridge` or `pnpm dev:web`.

Other root scripts:

| Script           | Does                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm build`     | `pnpm -r run build` across every workspace project                |
| `pnpm typecheck` | `pnpm -r run typecheck`                                           |
| `pnpm lint`      | ESLint 9 flat config over `apps/` + `packages/` only              |
| `pnpm format`    | Prettier over root tooling, `apps/`, `packages/`, and this README |
| `pnpm clean`     | Removes `dist/`, `.turbo/`, `*.tsbuildinfo`, and `node_modules/`  |

The Python side (bridge, tests) is deliberately **not** a pnpm workspace project; it is driven by
`scripts/dev-bridge.sh` and its own `pyproject.toml`.

## Conventions the root tooling enforces

- **The upstream PyMOL tree is never linted or formatted.** `eslint.config.js` ignores
  `packages/engine/layer0/`–`packages/engine/layer5/`, `packages/engine/modules/`, `packages/engine/data/`, `packages/engine/ov/`, `packages/engine/contrib/`, `packages/engine/examples/`, `packages/engine/include/`, `packages/engine/test/`,
  `packages/engine/testing/`, `build/`, `packages/engine/_custom_build/`, `docs/`; the Prettier scripts name their targets
  explicitly instead of using `.`. A `pnpm format` must never produce a diff in a PyMOL source file.
- **Path aliases resolve to package sources**, not to build output:
  `@tenmol/protocol`, `@tenmol/client`, `@tenmol/ui`, `@tenmol/viewport` → `packages/*/src`
  (see `tsconfig.base.json`). Subpath imports (`@tenmol/protocol/topics`) work too.
- **`tsconfig.base.json` does not set `composite`.** Each package that wants project references
  opts in locally (`"composite": true` + `rootDir`/`outDir` + `references`). Setting `composite`
  in the shared base makes any app that imports package _sources_ through a path alias fail with
  `TS6307: File … is not listed within the file list of project …`; this was reproduced and is why
  the flag lives in the packages instead. `declaration`, `declarationMap` and `incremental` are in
  the base, so opting in is a three-line change.
- **Strictness:** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`. `noUnusedLocals` /
  `noUnusedParameters` are deliberately left to ESLint (as warnings) so a work-in-progress file
  still typechecks.

## Deviations from `01-architecture.md` §6

`01-architecture.md` was written before this root existed; where they disagree, the files win.

| `01` §6                              | Actual                                                        |
| ------------------------------------ | ------------------------------------------------------------- |
| pnpm root at `webclient/`            | pnpm root at the repo root                                    |
| `@pymol/*` package scope             | `@tenmol/*`                                                   |
| `pnpm@10.4.1`, node `>=20.11`        | `pnpm@9.15.4`, node `>=22` (what is installed here)           |
| `turbo run build` / `turbo.json`     | `pnpm -r run build` — no Turborepo dependency                 |
| workspace globs include `tools/*`    | `apps/*` and `packages/*` only (add `tools/*` when it exists) |
| `composite: true` in the shared base | opted into per package (see above)                            |
| `scripts/dev.mjs`                    | `concurrently` + `scripts/dev-bridge.sh`                      |

## Open blockers that this tooling does not solve

From `02-completeness-critique.md`, still unresolved and owned by the packages/bridge/viewport work:
A1 (the draw/refresh pump), A2 (`ModalDraw` deadlock), A3 (sequence-viewer model source),
A4 (`pymol.glutThread` must be set or ordering is fiction), A5 (server- vs client-side picking),
A6 (the dispatcher deny-list contradicts required features). `spikes/00-build.md` §6.1 adds a hard
constraint: `_cmd._draw()` **segfaults** without a GL context, and takes the process with it.
