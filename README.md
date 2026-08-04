# tenmol

A fork of [PyMOL](https://github.com/schrodinger/pymol-open-source) that keeps the C++/Python
engine and replaces the Qt front-end with a React web app.

The engine lives in **`packages/engine/`** and is upstream code, edited in four places and
otherwise untouched (see [What we changed in the engine](#what-we-changed-in-the-engine)).
Everything else under `packages/`, plus `apps/web`, is this project.

```
tenmol/
├─ apps/
│  └─ web/               the React app (Vite)
│
├─ packages/
│  ├─ engine/            upstream PyMOL — layer0…layer5, modules, ov, data,
│  │                     contrib, plus its own setup.py + CMakeLists
│  ├─ bridge/            the Python bridge that owns the PyMOL process
│  ├─ protocol/          the wire types, shared by both ends
│  ├─ client/            the socket client
│  ├─ stores/            state
│  └─ viewport/          the canvas, both render modes, input, picking
│
├─ docs/                 architecture, parity inventory, area maps, spikes
├─ scripts/              bootstrap · dev-bridge · doctor · parity · ownership
├─ tools/                API codegen, parity lint
└─ package.json          ← the entrypoint; `pnpm dev` starts everything
```

`packages/engine/` is self-contained: its `setup.py` uses paths relative to itself, so it builds
without knowing this repo exists.

## Run it

```sh
pnpm install                # once
bash scripts/bootstrap.sh   # once — builds packages/engine/ into packages/bridge/.venv
pnpm dev                    # bridge on :8765, web app on :5173
```

Open <http://localhost:5173>. Then, in the app's command line:

```
load packages/engine/test/dat/1tii.pdb
show cartoon
spectrum count, rainbow
```

`pnpm run doctor` checks every prerequisite (node, pnpm, the venv, `import pymol`, offscreen GL,
the dev ports) and tells you which one is missing before you try to start anything. Use
`pnpm run doctor`, not `pnpm doctor` — the latter hits pnpm's own builtin.

## Checks

```sh
pnpm test              # web unit + DOM tests (vitest)
pnpm test:bridge       # bridge tests (pytest, boots a real PyMOL — several minutes)
pnpm typecheck         # tsc across every workspace package
pnpm lint              # eslint; never touches the upstream tree
pnpm build             # production build of the web app
pnpm parity            # the parity scoreboard

node apps/web/e2e/run.mjs            # end-to-end, real Chromium against a live bridge
node apps/web/e2e/run.mjs -t "scene" # one spec by name
```

The bridge suite can also be run directly, which is faster to iterate on:

```sh
packages/bridge/.venv/bin/python -m pytest packages/bridge/tests -q
```

## How it fits together

One PyMOL process, one browser, on localhost, with full filesystem access — a local desktop
replacement, not a multi-tenant server.

**`packages/bridge/`** owns the engine. It is a FastAPI + WebSocket service wrapping a single PyMOL
instance: one thread that holds an offscreen GL context, the engine and a 60 Hz draw pump; a policy
layer deciding what a client may call; and panels exposing feature-specific RPCs. The web app never
touches PyMOL directly.

**`apps/web/`** is the UI, assembled from feature slots mounted by id from a registry, so features
stay independent of the shell.

The viewport has **two render modes**. *Mode P* has the server rasterise and stream pixels — full
PyMOL fidelity, and it needs an offscreen GL context on the host (hardware or software: CGL on
macOS, EGL on Linux down to llvmpipe, WGL on Windows). *Mode G* extracts geometry and draws it in
the browser with WebGL, so the server never draws at all; an e2e spec asserts exactly that, with
the bridge's draw counter pinned at zero while you drag and pick.

`docs/architecture.md` is the full version.

## What we changed in the engine

Every C++ edit is wrapped in `/* tenmol web client -- BEGIN */` … `/* -- END */` sentinels so it
can be found and re-applied after an upstream merge.

| File | Change |
| --- | --- |
| `packages/engine/layer4/CmdWebGeometry.cpp` | **New file** — the Mode G geometry accessor. Auto-globbed by `setup.py`, and upstream has no such file, so it can never conflict on merge. |
| `packages/engine/layer4/Cmd.cpp` | Method-table rows for that accessor. One contiguous insertion. |
| `packages/engine/layer3/Executive.cpp`, `.../ExecutiveDef.h` | Monotonic change counters on `CExecutive`, used as cache hints. |
| `packages/engine/pyproject.toml` | `readme = "PYMOL-README.md"`, because upstream's `README.md` was renamed to make room for this one. |

To rebuild the C++ after editing `packages/engine/layer*/`:

```sh
cmake --build packages/engine/build/temp.*/_cmd
cp packages/engine/build/lib.*/pymol/_cmd.cpython-*.so \
   packages/bridge/.venv/lib/python3.13/site-packages/pymol/
```

For a clean rebuild, `bash scripts/bootstrap.sh --force-pymol`. `docs/build-and-tooling.md` covers
the build in full, including the failure catalogue.

## Where the work is tracked

`docs/feature-parity.md` is the definition of done: one row per Qt-GUI affordance, each citing
the upstream `file:line` it came from and the backend symbol behind it. `node scripts/parity.mjs`
scores it — 365 rows today. `docs/README.md` maps the rest of the documentation.

Every path cited in comments and docs is relative to the repo root — upstream as
`packages/engine/layer1/Scene.cpp:2885`, ours as `packages/bridge/tests/test_p11_geom.py`. The
bridge runs with the repo root as its working directory, which is why PyMOL data loads as
`packages/engine/test/dat/…`.
