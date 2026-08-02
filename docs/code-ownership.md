# File ownership map

**This file is machine-readable input, not prose.** `scripts/ownership.mjs` parses section 6
and nothing else reads it.

The web client was built by a fleet of parallel agents, one per work package (WP-00 … WP-31).
Every file in the tree was assigned to exactly one of them so that two agents could never write
the same file. The table below is that assignment, and it is the whole of what survives from the
build plan.

```sh
node scripts/ownership.mjs --who packages/viewport/src/picking/ray.ts   # who owns this path?
node scripts/ownership.mjs --list WP-09                                 # what does this WP own?
TENMOL_WP=WP-09 node scripts/ownership.mjs                              # lint the working tree
```

Exit 0 = clean, 1 = a changed file belongs to another WP, 2 = usage error.
`.github/workflows/webclient-ci.yml` runs `--list WP-00` on every build purely to prove this file
still parses, and the cross-WP diff check only on branches named `wp-NN-*`. **Do not reformat the
`**Owns:**` blocks below** — the parser reads them.

**It is a historical partition, not an inventory of the tree.** It names files that were planned
and never written (`packages/ui/`, `tools/gen-menus/`, `tenmol_bridge/raster.py`) and it predates
later refactors (`glcontext.py` is now a package, `panels/` grew several modules). Do not read it as
a description of what exists — for that, read the tree, or `docs/architecture.md`.

---

### Wave 0 — foundation

#### WP-00 — Monorepo, bootstrap, and the frozen skeleton
**Owns:**
```
package.json  pnpm-workspace.yaml  tsconfig.base.json  .npmrc  .prettierrc
eslint.config.js  .gitignore  vitest.workspace.ts
scripts/bootstrap.sh  scripts/dev-bridge.sh  scripts/doctor.mjs
.github/workflows/webclient-*.yml
```

#### WP-01 — `@tenmol/protocol` wire contract
**Owns:**
```
packages/protocol/package.json  packages/protocol/tsconfig.json
packages/protocol/src/index.ts  src/envelope.ts  src/errors.ts  src/codec.ts
packages/protocol/src/topics/index.ts  src/topics/_registry.ts
packages/protocol/src/geometry.ts        (binary frame header + zero-copy views)
```

#### WP-02 — Bridge core: GL context, engine thread, pump, dispatch, policy, codec
**Owns:**
```
packages/bridge/pyproject.toml  packages/bridge/README.md  packages/bridge/tests/conftest.py
packages/bridge/tests/test_process_model.py  packages/bridge/tests/test_dispatch.py
packages/bridge/tenmol_bridge/{__init__,__main__,config,errors,codec}.py
packages/bridge/tenmol_bridge/glcontext.py  engine.py  pump.py
packages/bridge/tenmol_bridge/{dispatch,server,session,blobs,shims,incentive_only}.py
packages/bridge/tenmol_bridge/policy/{__init__,base}.py
packages/bridge/tenmol_bridge/panels/__init__.py          (frozen barrel)
packages/bridge/tenmol_bridge/state/__init__.py           (frozen barrel)
```

### Wave 1 — spines

#### WP-03 — Feedback, status thread, state tick
**Owns:**
```
packages/bridge/tenmol_bridge/feedback.py  status.py
packages/bridge/tenmol_bridge/state/{snapshot,diff}.py
packages/bridge/tests/test_events.py
packages/protocol/src/topics/{feedback,progress,redisplay}.ts
packages/stores/src/feedback.ts        (shared with WP-11? NO — see note)
```

#### WP-04 — Mode P: server-rendered pixel stream (bridge side)
**Owns:**
```
packages/bridge/tenmol_bridge/raster.py
packages/bridge/tests/test_raster.py
packages/protocol/src/topics/pixels.ts
```

#### WP-05 — API schema extraction + TS codegen
**Owns:**
```
tools/gen-api/**  (extract.py, emit.ts, package.json, overrides/index.ts — frozen barrel)
packages/client/src/generated/**
```

#### WP-06 — `@tenmol/client` transport
**Owns:**
```
packages/client/package.json  tsconfig.json
packages/client/src/{index,connection,events,cmd,reconnect,blob}.ts
```

#### WP-07 — App shell, `@tenmol/ui`, theme, feature registry
**Owns:**
```
apps/web/{index.html,vite.config.ts,tsconfig.json,package.json,README.md,.gitignore}
apps/web/src/main.tsx
apps/web/src/app/**            (App.tsx, BridgeProvider, routing)
apps/web/src/shell/**          (AppShell, ExternalGuiPanel, InternalGuiColumn, StatusBar, Docking)
apps/web/src/styles/**
apps/web/src/features/registry.ts        (FROZEN barrel, written once, lists every feature)
packages/ui/package.json  tsconfig.json  packages/ui/src/**   EXCEPT packages/ui/src/menu/**
```

#### WP-08 — `@tenmol/stores` skeleton
**Owns:**
```
packages/stores/package.json  tsconfig.json
packages/stores/src/index.ts        (FROZEN barrel listing all 14 stores)
packages/stores/src/createStore.ts  bridgeBinding.ts  ui.ts
```

### Wave 2 — viewport and core UI

#### WP-09 — Viewport (Mode P presenter), camera, resize
**Owns:**
```
packages/viewport/package.json  tsconfig.json
packages/viewport/src/**  EXCEPT src/input/**, src/picking/**, src/webgl/**, src/materials/**, src/shaders/**
apps/web/src/features/viewport/**
packages/protocol/src/topics/view.ts
packages/stores/src/view.ts
```

#### WP-10 — Input and picking
**Owns:**
```
packages/bridge/tenmol_bridge/input.py  picking.py
packages/viewport/src/input/**  packages/viewport/src/picking/**
packages/protocol/src/pick.ts  packages/protocol/src/topics/selection.ts
packages/stores/src/selection.ts
apps/web/src/features/picking/**
packages/bridge/tests/test_picking.py
```

#### WP-11 — Console
**Owns:**
```
apps/web/src/features/console/**
packages/stores/src/feedback.ts
```

#### WP-12 — Object panel
**Owns:**
```
packages/bridge/tenmol_bridge/panels/objects.py
packages/protocol/src/topics/objects.ts
packages/stores/src/objects.ts
apps/web/src/features/objects/**
tools/gen-api/overrides/executive.ts
```

#### WP-13 — PyMOL popup-menu engine
**Owns:**
```
packages/bridge/tenmol_bridge/panels/menus.py
packages/protocol/src/topics/menu.ts
packages/stores/src/menu.ts
packages/ui/src/menu/**        (Menu, MenuItem, SubMenu, Popover, Separator)
apps/web/src/features/pymol-menu/**
packages/bridge/tenmol_bridge/policy/grants/wp-13.py
```

#### WP-14 — Menu bar + menu-data codegen
**Owns:**
```
tools/gen-menus/**
packages/menu-data/**
apps/web/src/features/menubar/**
```

#### WP-15 — Settings
**Owns:**
```
packages/bridge/tenmol_bridge/settings_service.py
packages/protocol/src/topics/settings.ts
packages/stores/src/settings.ts
apps/web/src/features/settings/**
tools/gen-api/overrides/setting.ts
```

### Wave 3 — feature surfaces (parallel)

#### WP-16 — Wizards
**Owns:** `packages/protocol/src/topics/wizard.ts`, `packages/stores/src/wizard.ts`,
`apps/web/src/features/wizards/**`, `packages/bridge/tenmol_bridge/policy/grants/wp-16.py`

#### WP-17 — Builder
**Owns:** `packages/protocol/src/topics/editor.ts`, `packages/stores/src/editor.ts`,
`apps/web/src/features/builder/**`

#### WP-18 — File I/O and blocking dialogs
**Owns:** `packages/bridge/tenmol_bridge/fs.py`, `dialogs.py`, `packages/protocol/src/topics/dialog.ts`,
`packages/stores/src/dialog.ts`, `apps/web/src/features/files/**`,
`apps/web/src/features/dialogs/shared/**`, `packages/bridge/tenmol_bridge/policy/grants/wp-18.py`

#### WP-19 — Render pipeline
**Owns:** `packages/bridge/tenmol_bridge/render.py`, `apps/web/src/features/render/**`

#### WP-20 — Movies, scenes, states
**Owns:** `packages/bridge/tenmol_bridge/panels/movie.py`, `packages/protocol/src/topics/{frame,scenes,
movie_panel}.ts`, `packages/stores/src/{movie,scenes}.ts`, `apps/web/src/features/{movie,scenes}/**`

#### WP-21 — Sequence viewer
**Owns:** `packages/bridge/tenmol_bridge/panels/seqview.py`, `packages/protocol/src/topics/seqview.ts`,
`packages/stores/src/seqview.ts`, `apps/web/src/features/seqview/**`

#### WP-22 — Dialogs: volume, properties, colors, text editor
**Owns:** `packages/protocol/src/topics/colors.ts`, `packages/stores/src/colors.ts`,
`apps/web/src/features/{colors,volume,properties,texteditor}/**`

#### WP-23 — Keyboard and mouse configuration
**Owns:** `packages/protocol/src/keys.ts`, `apps/web/src/features/keyboard/**`,
`apps/web/src/features/shortcuts/**`

#### WP-24 — Compute and analysis menus
**Owns:** `apps/web/src/features/compute/**`, `tools/gen-api/overrides/util.ts`,
`packages/bridge/tenmol_bridge/policy/grants/wp-24.py`

#### WP-25 — Plugin surface (read-only)
**Owns:** `packages/bridge/tenmol_bridge/plugins_service.py`, `packages/protocol/src/topics/plugin.ts`,
`packages/stores/src/plugins.ts`, `apps/web/src/features/plugins/**`

### Wave 4 — post-v1 and quality

#### WP-26 — Mode G: C++ geometry accessor + WebGL viewport
**Owns:**
```
packages/engine/layer4/CmdWebGeometry.cpp        (new)
packages/engine/layer4/Cmd.cpp                   (method-table insertion ONLY, sentinel-marked)
packages/bridge/tenmol_bridge/geometry/**
packages/protocol/src/topics/geometry.ts
packages/viewport/src/webgl/**  src/materials/**  src/shaders/**  src/geometryCache.ts
tools/gen-shaders/**
```

#### WP-27 — Parity harness, ownership lint, CI
**Owns:** `tools/parity/**`, `packages/testing/**`, `apps/web/e2e/**`, `packages/bridge/tests/test_parity.py`

#### WP-28 — Packaging and entry point
**Owns:** `packages/bridge/tenmol_bridge/cli.py`, packaging config, `docs/USAGE.md`

#### WP-30 — APBS Electrostatics (v1.1)
**Depends on:** WP-25 · **Owns:** `apps/web/src/features/apbs/**`, `packages/bridge/tenmol_bridge/apbs.py`

#### WP-31 — Full Plugin Manager (v1.1, after security review)
**Depends on:** WP-25 · **Owns:** `apps/web/src/features/plugin-manager/**`,
`packages/bridge/tenmol_bridge/plugin_install.py`
---
