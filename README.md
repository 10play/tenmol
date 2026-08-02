# tenmol

A fork of [PyMOL](https://github.com/schrodinger/pymol-open-source) that keeps the C++/Python
engine and replaces the Qt front-end with a React web app.

The engine is unmodified upstream code in **`packages/engine/`**; everything this project
adds is the rest of `packages/`, plus `apps/web`.

```
tenmol/
├─ apps/
│  └─ web/               the React app (Vite)
│
├─ packages/
│  ├─ engine/            upstream PyMOL, unmodified — layer0…layer5, modules,
│  │                     ov, data, contrib, plus its own setup.py + CMakeLists
│  ├─ bridge/            the Python bridge that owns the PyMOL process
│  ├─ protocol/          the wire types, shared by both ends
│  ├─ client/            the socket client
│  ├─ stores/            state
│  └─ viewport/          WebGL rendering, input, picking
│
├─ docs/                 parity inventory, architecture, spikes
├─ scripts/              bootstrap · dev-bridge · doctor
├─ tools/                API codegen, parity lint
└─ package.json          ← the entrypoint; `pnpm dev` starts everything
```

`packages/engine/` is self-contained: its `setup.py` uses paths relative to itself, so it
builds without knowing this repo exists.

## Run it

```sh
pnpm install          # once
bash scripts/bootstrap.sh   # once — builds packages/engine/ into packages/bridge/.venv
pnpm dev              # bridge on :8765, web app on :5173
```

Open <http://localhost:5173>. Then, in the app's command line:

```
load packages/engine/test/dat/1tii.pdb
show cartoon
spectrum count, rainbow
```

`pnpm run doctor` checks every prerequisite (node, pnpm, the venv, `import pymol`, offscreen GL,
the dev ports) and tells you which one is missing before you try to start anything.

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

## How it fits together

One PyMOL process, one browser, on localhost, with full filesystem access — a local desktop
replacement, not a multi-tenant server.

**`packages/bridge/`** owns the engine. It is a FastAPI + WebSocket service wrapping a single PyMOL
instance: a *pump* that owns the engine thread, a *policy* layer deciding what a client may call,
and *panels* exposing feature-specific RPCs. The web app never touches PyMOL directly.

**`apps/web/`** is the UI, assembled from feature slots mounted by id from a registry, so
features stay independent of the shell.

The viewport has **two render modes**. *Mode P* has the server rasterise and stream pixels — full
PyMOL fidelity, needs a GPU on the host. *Mode G* extracts geometry and draws it in the browser
with WebGL, so the server never draws at all; an e2e spec asserts exactly that, with the bridge's
draw counter pinned at zero while you drag and pick. Mode G is what makes a GL-free backend work.

## Where the work is tracked

`docs/00-parity-inventory.md` is the definition of done: 365 rows, one per Qt-GUI affordance,
each citing the upstream `file:line` it came from and the backend symbol behind it. Read
`docs/README.md` for the rest of the design record.

Every path cited in comments and docs is relative to the REPO ROOT — upstream as
`packages/engine/layer1/Scene.cpp:2885`, ours as `packages/bridge/tests/test_p11_geom.py`. The bridge runs
with the repo root as its working directory, which is why PyMOL data loads as
`packages/engine/test/dat/…`.

To rebuild the C++ after editing `packages/engine/layer*/`: `cmake --build .` inside
`packages/engine/build/temp.*/_cmd` relinks in about a second, then copy the `.so` into the venv.
For a clean rebuild use `bash scripts/bootstrap.sh --force-pymol`.
