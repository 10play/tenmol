# 01 — Architecture: PyMOL Web Client

**Status:** authoritative plan. Every other document in `docs/` is an *area map* (a
read-only inventory of the existing Qt/C++ front-end). This document is the *build plan* those
maps feed into.

**Scope rule for this document:** it defines directory layout, process model, wire protocol,
client architecture, work-package ownership, and the parity-test strategy. It does **not**
re-enumerate features — the 12 area maps do that, and each work package below points at the map
that is its requirements spec.

---

## 0. Ground truth I verified myself

Everything asserted about the *build* in this document was checked directly against this tree.
Feature-level claims are attributed to the area map that read them.

| Claim | Evidence | Verified here |
|---|---|---|
| The engine is a single CPython extension `pymol._cmd`; the Python API is `packages/engine/modules/pymol/` | `pyproject.toml:20-27` (`build-backend = "backend"`, `backend-path = ["_custom_build"]`), `pyproject.toml:53-54` (`packages.find where = ["modules"]`) | ✓ |
| The headless engine is startable from Python with no GUI toolkit at all | `packages/engine/modules/pymol2/__init__.py:28-73` — `SingletonPyMOL.start()` calls `_cmd._new(pymol, pymol.invocation.options, True)` then `_cmd._start`; exposes `idle/getRedisplay/reshape/draw/button/drag` | ✓ |
| `pymol.launch()` already has a no-GUI branch driven purely by `idle()`/`draw()` | `packages/engine/modules/pymol/__init__.py:386-403` (`_launch_no_gui`), dispatched at `:416-417` | ✓ |
| **The feedback queue is gated on `pmgui`, and `pmgui = !no_gui`** | `packages/engine/layer1/Ortho.cpp:495` (`if (G->Option->pmgui)`) and `packages/engine/layer1/P.cpp:1820` (`rec->pmgui = !PyInt_AsLong(... "no_gui")`) | ✓ |
| `G->HaveGUI` is set from the same flag | `packages/engine/layer5/PyMOL.cpp:2248` (`I->G->HaveGUI = I->G->Option->pmgui`) | ✓ |
| A valid GL context is only asserted around draw/render paths, via an explicit push/pop | `packages/engine/layer5/PyMOL.cpp:2940-2949` (`PyMOL_PushValidContext` / `PyMOL_PopValidContext`), used at `:2115,:2281,:2303` | ✓ |
| Feedback is drained one string per call and returns `None` under lock contention | `packages/engine/modules/pymol/internal.py:593-606`; C side `packages/engine/layer4/Cmd.cpp:6463` (`{"get_feedback", CmdGetFeedback, METH_VARARGS}`) | ✓ |
| Setting-change notification is a **consume-once drain** | `packages/engine/modules/pymol/setting.py:440-447`; C side `packages/engine/layer4/Cmd.cpp:6495` | ✓ |
| Binary float blobs already have a first-class serializer | `packages/engine/layer1/PConv.cpp:971-977` (`PConvFloatArrayToPyList(..., bool dump_binary)` → `PyBytes_FromStringAndSize`), int variant at `:1061-1064` | ✓ |
| Surface geometry is CPU-resident on the Rep and never freed after upload | `packages/engine/layer2/RepSurface.cpp:59-101` — `std::vector<float> V, VN, VC, VA, VAO; std::vector<int> RC, Vis, T, S, AT` | ✓ |
| CGO ↔ Python round-trip already exists and already expands `CGO_DRAW_ARRAYS` | `packages/engine/layer1/CGO.cpp:241` (`CGOArrayAsPyList`), `:289` (`CGOAsPyList`), inverse noted at `:308` | ✓ |
| **A new `packages/engine/layer4/*.cpp` file needs zero build-file edits** | `setup.py:808-816` (`get_sources` globs `d + "/*" + s`), `setup.py:559-568` (`pymol_src_dirs` includes `"layer4"`), `CMakeLists.txt:7` (`add_library(${TARGET_NAME} SHARED ${ALL_SRC})`) | ✓ |
| GLSL sources that must be ported to WebGL2 are on disk and enumerable | `packages/engine/data/shaders/` — 46 files incl. `sphere.vs/.fs`, `cylinder.vs/.fs`, `surface.vs/.fs`, `default.vs/.fs`, `line.vs/.fs`, `trilines.vs/.fs`, `label.vs/.fs`, `oit.vs/.fs`, `volume.vs/.fs`, `ramp.vs/.fs` | ✓ |
| `cmd.do` swallows return values and exceptions | `packages/engine/modules/pymol/commanding.py:441-461` + parser behaviour documented in the `cmd-api-rpc` map (`packages/engine/modules/pymol/parser.py:465-481`) | ✓ |
| The existing HTTP bridge hard-rejects non-loopback peers and is single-threaded | `packages/engine/modules/pymol/pymolhttpd.py:35-38` (single-threaded comment), `:61-68` (`host[0:6] != '127.0.'` → 403) | ✓ |
| `.gitignore` currently ignores `build`, `generated`, `*.pyc` only | `.gitignore` (5 lines) — so `webclient/` needs its own ignore rules | ✓ |

### 0.1 The single most important finding in this document

`pmgui` controls **both** things we care about, in opposite directions:

* `pmgui = 0` (i.e. `--no-gui`) → `G->HaveGUI = false` (`packages/engine/layer5/PyMOL.cpp:2248`), which is what we
  want (no GL) — **but** `OrthoFeedbackIn` silently drops every message (`packages/engine/layer1/Ortho.cpp:495`),
  so `cmd._get_feedback()` returns `[]` forever and the web console is permanently blank.
* `pmgui = 1` → feedback works, but `HaveGUI` is true.

**Decision:** the bridge runs with `pmgui = 1` (i.e. *not* `--no-gui`) and **never calls
`draw()`**. `HaveGUI` being true is harmless as long as no render pass runs, because every GL
branch is additionally gated on `G->ValidContext`, which is only ever raised inside the
draw/render paths via `PyMOL_PushValidContext` (`packages/engine/layer5/PyMOL.cpp:2940`, called at `:2115,:2281,
:2303`). The bridge pump therefore calls `p.idle()` and `p.getRedisplay()` but **never**
`p.draw()`.

This must be asserted in a test on day one (WP-02 acceptance), because if it is wrong, either the
console or the geometry extractor is dead, and both are load-bearing.

---

## 1. Monorepo layout

### 1.1 Principles

1. **The upstream PyMOL tree is not moved, not renamed, and not reorganised.** `packages/engine/layer0/`–`packages/engine/layer5/`,
   `packages/engine/modules/`, `packages/engine/data/`, `setup.py`, `pyproject.toml`, `CMakeLists.txt` stay exactly where they are.
   A `git merge` from upstream `pymol-open-source` must never touch a web-client file.
2. **All new code lives under `webclient/`**, plus exactly one new C++ file in `packages/engine/layer4/` and
   exactly one small edit to `packages/engine/layer4/Cmd.cpp` (§1.3).
3. **The bridge is a separate installable Python package**, `pymol-bridge`, not a new
   `packages/engine/modules/pmg_web/` package — so it version-skews independently and never collides with an
   upstream file.
4. **pnpm workspace root is `webclient/`, not the repo root.** Putting `package.json` at the repo
   root would put a Node manifest next to `setup.py` and confuse every tool that auto-detects
   project type (and every future upstream merge). `webclient/` is a self-contained JS project.

### 1.2 Tree

```
tenmol/                                   # repo root — upstream layout, untouched
├─ packages/engine/layer0/ … packages/engine/layer3/                      #   (untouched)
├─ packages/engine/layer4/
│  ├─ Cmd.cpp                             #   ONE edit: method-table rows (§1.3)
│  └─ CmdWebGeometry.cpp                  #   NEW — auto-globbed by setup.py:808-816
├─ packages/engine/layer5/  packages/engine/layerGraphics/  packages/engine/ov/           #   (untouched)
├─ packages/engine/modules/                               #   (untouched — read-only for this project)
├─ packages/engine/data/                                  #   (untouched; shaders read at build time by codegen)
├─ setup.py  pyproject.toml  CMakeLists.txt   # (untouched)
├─ docs/*.md                    # the 12 area maps + this document
└─ webclient/                             # ← everything new
   ├─ package.json                        # workspace root manifest (§6.2)
   ├─ pnpm-workspace.yaml                 # (§6.1)
   ├─ pnpm-lock.yaml                      # committed
   ├─ tsconfig.base.json                  # (§6.3)
   ├─ turbo.json                          # task graph + caching
   ├─ .npmrc
   ├─ .gitignore
   ├─ eslint.config.js
   ├─ prettier.config.mjs
   ├─ vitest.workspace.ts
   ├─ README.md
   │
   ├─ scripts/
   │  ├─ dev.mjs                          # THE dev script (§6.4)
   │  ├─ bootstrap.sh                     # build+install pymol, install bridge, pnpm i, codegen
   │  └─ doctor.mjs                       # environment preflight (python, pymol import, pnpm)
   │
   ├─ packages/bridge/                             # Python — the PyMOL-side service
   │  ├─ pyproject.toml                   # name = "pymol-bridge"; deps: fastapi, uvicorn, msgpack
   │  ├─ README.md
   │  ├─ tests/
   │  │  ├─ test_process_model.py
   │  │  ├─ test_dispatch.py
   │  │  ├─ test_events.py
   │  │  ├─ test_geometry.py
   │  │  └─ conftest.py
   │  └─ pymol_bridge/
   │     ├─ __init__.py
   │     ├─ __main__.py                   # `python -m pymol_bridge --port 8765`
   │     ├─ config.py                     # CLI/env → BridgeConfig
   │     ├─ engine.py                     # SingletonPyMOL lifecycle + the PyMOL thread
   │     ├─ pump.py                       # idle/getRedisplay loop + tick scheduler
   │     ├─ dispatch.py                   # call/batch/do/complete/usage/help/cancel
   │     ├─ allowlist.py                  # frozen allow-list + deny-list of cmd symbols
   │     ├─ errors.py                     # CmdException/QuietException → wire error
   │     ├─ codec.py                      # msgpack ext types, blob refs
   │     ├─ server.py                     # FastAPI app: /ws, /health, /schema, /blob, /upload
   │     ├─ session.py                    # one client, token auth, heartbeat, lifecycle
   │     ├─ blobs.py                      # out-of-band large payload store
   │     ├─ events/
   │     │  ├─ __init__.py                # EventBus, topic registry, seq numbers
   │     │  ├─ feedback.py                # drains cmd._get_feedback()
   │     │  ├─ settings.py                # drains cmd.get_setting_updates()
   │     │  ├─ progress.py                # cmd.get_progress()
   │     │  ├─ snapshot.py                # shadow-diff: objects, view, frame, scenes, wizard
   │     │  └─ geometry.py                # rep-invalidation → geometry re-pull events
   │     ├─ geometry/
   │     │  ├─ __init__.py
   │     │  ├─ extract.py                 # wraps _cmd.get_rep_geometry
   │     │  ├─ cgo.py                     # CGO_DRAW_ARRAYS block decoding/repacking
   │     │  └─ labels.py                  # glyph atlas + label anchors
   │     ├─ panels/
   │     │  ├─ objects.py                 # object-panel snapshot (names/type/vis/group/caption)
   │     │  ├─ movie.py                   # movie-panel spec-levels per row
   │     │  ├─ seqview.py                 # sequence-viewer model
   │     │  └─ menus.py                   # pymol.menu.* + wizard get_menu resolution
   │     ├─ fs.py                         # server-side file browsing / upload / save targets
   │     ├─ render.py                     # ray/draw/png → PNG bytes → blob
   │     ├─ input.py                      # button/drag/key forwarding, pick routing
   │     └─ shims.py                      # _copy_image, _call_in_gui_thread, gui.get_qtwindow
   │
   ├─ tools/
   │  ├─ gen-api/                         # cmd API → api-schema.json → TS
   │  │  ├─ extract.py                    # runs INSIDE `pymol -cq`
   │  │  ├─ emit.ts
   │  │  ├─ overrides.ts                  # hand-maintained return types
   │  │  └─ package.json
   │  ├─ gen-menus/                       # _gui.get_menudata + pymol.menu → JSON descriptors
   │  │  ├─ extract.py
   │  │  ├─ emit.ts
   │  │  └─ package.json
   │  ├─ gen-shaders/                     # packages/engine/data/shaders/*.{vs,fs} → WebGL2 GLSL modules
   │  │  ├─ transpile.mjs
   │  │  └─ package.json
   │  └─ parity/                          # parity-matrix generator + checker (§7)
   │     ├─ extract-features.mjs          # parses docs/*.md feature tables
   │     ├─ check.mjs
   │     └─ package.json
   │
   ├─ packages/
   │  ├─ protocol/                        # @pymol/protocol — wire types only, zero runtime deps
   │  │  └─ src/{index,envelope,topics,errors,geometry,panels,codec}.ts
   │  ├─ client/                          # @pymol/client — transport + typed cmd
   │  │  └─ src/{index,transport,client,call,batch,blob,events,keymap}.ts
   │  │      └─ generated/{cmd,settings,colors,enums,schema.json}.ts
   │  ├─ stores/                          # @pymol/stores — Zustand stores mirroring PyMOL state
   │  │  └─ src/{index,settings,objects,feedback,view,movie,scenes,wizard,editor,colors,ui}.ts
   │  ├─ viewport/                        # @pymol/viewport — three.js renderer
   │  │  └─ src/{index,Viewport,scene,camera,geometryCache,picking,input}/…
   │  │      └─ materials/{sphere,cylinder,surface,default,line,label,ramp}.ts
   │  │      └─ shaders/generated/*.glsl.ts
   │  ├─ menu-data/                       # @pymol/menu-data — generated menu descriptors
   │  │  └─ src/{index,types}.ts + generated/{menubar,pymol-menus}.json
   │  ├─ ui/                              # @pymol/ui — design primitives (Radix + Tailwind)
   │  │  └─ src/{Button,Menu,Popover,Dialog,Table,Tree,Slider,ColorSwatch,Splitter,…}.tsx
   │  └─ packages/engine/testing/                         # @pymol/testing — parity harness + fixtures
   │     └─ src/{parity,fixtures,goldens,mockBridge}.ts
   │
   └─ apps/
      └─ web/                             # @pymol/web — the Vite React app
         ├─ index.html  vite.config.ts  tailwind.config.ts  tsconfig.json
         ├─ e2e/                          # Playwright specs (parity suites)
         └─ src/
            ├─ main.tsx  App.tsx  BridgeProvider.tsx
            ├─ shell/{AppShell,MenuBar,ExternalGuiPanel,InternalGuiColumn,StatusBar,Docking}.tsx
            └─ features/
               ├─ menubar/    objects/    pymol-menu/    console/
               ├─ wizards/    builder/    files/         render/
               ├─ movie/      scenes/     seqview/       settings/
               ├─ colors/     dialogs/    shortcuts/     keyboard/
```

### 1.3 The only two upstream touch-points, and why

Per the `geometry-extraction` map there is **no existing PyMOL API that can feed an interactive
geometry stream**: every geometry exporter (`get_vrml`, `get_collada`, `get_idtf`, `get_povray`,
`get_mtl_obj`, `get_gltf`) goes through `SceneRay` (`packages/engine/layer1/SceneRay.cpp:88`), re-rendering the
whole scene into ray primitives and sprintf-ing ASCII, at 1–10 s (VRML) to 10–100 s (COLLADA) per
call, and each drops different primitive classes. There is no zero-backend-change fallback.

Therefore this project adds exactly:

1. **`packages/engine/layer4/CmdWebGeometry.cpp`** (new file). Implements `CmdGetRepGeometry`,
   `CmdGetCGOBlocks`, `CmdGetPanelSnapshot`, `CmdGetMoviePanel`, `CmdGetSeqView`,
   `CmdGetChangeCounters`, `CmdSetInvalidationCallback`. It reuses the existing binary serializer
   `PConvFloatArrayToPyList(ptr, len, /*dump_binary=*/true)` (`packages/engine/layer1/PConv.cpp:971-977`) and the
   existing CGO walker `CGOArrayAsPyList` (`packages/engine/layer1/CGO.cpp:241`) as its reference implementation.
   **No build-file edit is required**: `setup.py:808-816` globs `packages/engine/layer4/*.cpp` and
   `setup.py:559-568` lists `"layer4"`, feeding `${ALL_SRC}` at `CMakeLists.txt:7`.
2. **`packages/engine/layer4/Cmd.cpp`**: additional rows in the method table next to
   `{"get_feedback", CmdGetFeedback, METH_VARARGS}` (`packages/engine/layer4/Cmd.cpp:6463`), plus the matching
   forward declarations. This is a *pure insertion*, ~10 lines, in one contiguous region.

**Nothing else in `packages/engine/layer0/`–`packages/engine/layer5/` or `packages/engine/modules/` is edited by this project.** Both files are
owned by exactly one work package (WP-06) so no merge conflict is possible between agents. If a
second C++ need appears later it goes into `packages/engine/layer4/CmdWebGeometry.cpp` too, and the owning WP is
handed off explicitly.

> Contradiction with the brief, flagged as required: the brief says "keep the existing PyMOL
> C++/Python backend". We do — but "keep" cannot mean "add zero C++", because the geometry feed
> the brief asks for does not exist. The addition is strictly additive and confined to one new
> file plus one method table.

---

## 2. The Python bridge service

### 2.1 Process model

```
┌─ pymol-bridge process (one) ───────────────────────────────────────────────┐
│                                                                            │
│  MainThread ── asyncio/uvicorn event loop                                  │
│    • FastAPI: GET /health /schema /blob/{id}, POST /upload, WS /ws         │
│    • owns the WebSocket, msgpack framing, backpressure                     │
│    • NEVER touches pymol.cmd directly                                      │
│                             │  asyncio.Queue (in)   ▲ asyncio.Queue (out)  │
│                             ▼                       │                      │
│  PyMOLThread (exactly one, non-daemon)                                     │
│    • pymol2.SingletonPyMOL().start()      packages/engine/modules/pymol2/__init__.py:52-63 │
│    • strictly-ordered command loop: pops one request, executes, replies    │
│    • tick(): p.idle(); p.getRedisplay(); drain feedback/settings/progress  │
│    • NEVER calls p.draw()                                     (see §0.1)   │
│                                                                            │
│  Worker pool (small, opt-in)                                               │
│    • only for calls explicitly marked long-running (ray, png ray=1, align, │
│      map_generate, movie.produce). Uses cmd.async_ semantics.              │
└────────────────────────────────────────────────────────────────────────────┘
```

**Why one PyMOL thread rather than free-threading `cmd`.** `cmd` is guarded by an API lock
(`packages/engine/modules/pymol/locking.py:26-40`) and several drains fail *silently* under contention —
`cmd._get_feedback()` returns `None` when `lock_attempt` fails (`packages/engine/modules/pymol/internal.py:596,605`)
and `cmd.get_setting_updates()` returns `[]` the same way (`packages/engine/modules/pymol/setting.py:442-447`).
Worse, per the `input-mouse-keyboard` map, all viewport input is queued through `OrthoDefer`
(`packages/engine/layer1/Scene.cpp:4113-4155`) with captured timestamps, so **reordering input corrupts drag
state**. A single ordered thread makes both problems structurally impossible.

**Startup sequence** (`pymol_bridge/engine.py`):

1. `pymol.invocation.parse_args([...])` with a fixed option profile:
   `-q` (quiet), `-x` (no external GUI), **not** `-c`/`--no-gui` — see §0.1 — and
   `read_stdin=0`, `keep_thread_alive=1`, `show_splash` per config.
2. `p = pymol2.SingletonPyMOL(); p.start()` (`packages/engine/modules/pymol2/__init__.py:52-63`).
3. `import pcatch; pcatch._install()` so Python `print`/tracebacks land in the Ortho queue
   (per the `cmd-api-rpc` map: `packages/engine/layer1/P.cpp:2713-2721`, `:2663-2699`).
4. Install the GUI seams the backend expects to exist, in `pymol_bridge/shims.py`:
   `pymol.cmd._copy_image`, `pymol.cmd._call_in_gui_thread`, `pymol.cmd._call_with_opengl_context`,
   `pymol.gui.createlegacypmgapp`, and a `get_qtwindow()`-equivalent object implementing
   `window_cmd` so `cmd.window(...)` keeps dispatching to the client
   (per the `qt-main-window` map: `packages/engine/modules/pmg_qt/pymol_qt_gui.py:1245-1252`,
   `packages/engine/modules/pymol/viewing.py:1446-1457`).
   `_call_with_opengl_context` **raises a loud, typed error** rather than silently no-op-ing —
   there is no GL context in this process by design.
5. `_cmd.set_invalidation_callback(...)` (new, WP-06) to convert rep invalidation into events.
6. Start the pump; then start uvicorn.

**Shutdown.** A browser tab close cannot reliably run `cmd.quit()` (the `qt-main-window` map notes
`closeEvent` → `cmd.quit()` at `packages/engine/modules/pmg_qt/pymol_qt_gui.py:56-57` and that `confirm_quit`
confirms nothing at `:875-876`). The bridge therefore uses: WS heartbeat (`ping` every 5 s,
`--idle-timeout` default 0 = never), an explicit `POST /shutdown` with the session token, and an
unsaved-session guard driven by the `session_changed` setting. Default: **the bridge outlives the
tab** — reconnecting a browser resumes the same session.

### 2.2 Transport

| Concern | Choice | One-line justification |
|---|---|---|
| Server | **FastAPI + uvicorn**, single ASGI process | WS + HTTP + static in one process, native asyncio, trivial to embed. |
| Primary channel | **one WebSocket** `/ws` | Ordering and losslessness are correctness requirements (`OrthoDefer`), so exactly one channel. |
| Frame encoding | **MessagePack** (binary frames), JSON (text frames, dev only) | Geometry is `Float32Array`; msgpack `bin` is zero-copy on both ends and `msgpack` is already a dev dep (`pyproject.toml:33`). |
| Bulk payloads | **HTTP `GET /blob/{id}`** | Rendered PNGs, `.pse` bytes, CCP4 maps and MP4s must stream and be cancellable/resumable; they must not head-of-line-block the input channel. |
| Uploads | **`POST /upload`** → server temp path | The backend takes *paths*, not blobs (`packages/engine/modules/pymol/importing.py:643-827`). |
| Auth | 256-bit token minted at startup (file mode `0600`), passed as `?token=`, **plus** `Origin` allow-list, **plus** the loopback peer check | The dispatcher can reach `cmd.system`/`cmd.run`; `packages/engine/modules/pymol/pymolhttpd.py:61-68` already establishes the loopback precedent and it alone is not enough against a hostile local page. |
| Bind | `127.0.0.1` only, never `0.0.0.0` | Same reason; `packages/engine/modules/pymol/rpc.py` binding to `''` is the anti-pattern we are replacing. |

**Both legacy bridges are replaced, not extended.** `packages/engine/modules/pymol/pymolhttpd.py` discards POST
bodies, has dead batch code, and no push; `packages/engine/modules/pymol/rpc.py` does
`serv.register_instance(cmd)` with no auth and positional-only args. We keep three of their design
decisions: the flat `cmd` namespace, the `[method, args, kwds]` triple, and the
`{status, result}` envelope shape.

### 2.3 Message envelope

All frames are a map with `t` (type). Requests carry a client-monotonic `id: u32`. **Exactly one
terminal `ok` or `err` per request id.** Events carry no `id`.

```ts
// packages/protocol/src/envelope.ts  (owned by WP-01)

// ── client → server ───────────────────────────────────────────────────────
type Req =
  | { id: number; t: 'call';     m: string; a?: unknown[]; k?: Record<string, unknown> }
  | { id: number; t: 'batch';    calls: Array<{ m: string; a?: unknown[]; k?: object }> }
  | { id: number; t: 'do';       line: string }        // console only; ok.v is ALWAYS null
  | { id: number; t: 'complete'; line: string; cursor: number }
  | { id: number; t: 'usage';    m: string }
  | { id: number; t: 'help';     m: string }
  | { id: number; t: 'geom';     req: GeometryRequest } // §2.6
  | { id: number; t: 'input';    ev: InputEvent }       // button/drag/key/wheel/pick
  | { id: number; t: 'cancel';   target: number }
  | { id: number; t: 'sub';      topics: Topic[] }
  | {             t: 'ping';     ts: number };

// ── server → client ───────────────────────────────────────────────────────
type Res =
  | { id: number; t: 'ok';   v: unknown }
  | { id: number; t: 'err';  e: WireError }
  | { id: number; t: 'prog'; v: number; msg?: string }   // 0..1, may repeat
  | {             t: 'ev';   topic: Topic; seq: number; v: unknown }
  | {             t: 'pong'; ts: number };

interface WireError {
  kind: 'CmdException' | 'QuietException' | 'IncentiveOnly' | 'NotAllowed' | 'PythonError';
  label?: string;        // pymol.CmdException.label, default 'Error'
  message: string;
  traceback?: string[];
}
```

**Dispatch rules** (`pymol_bridge/dispatch.py`):

* `m` is a flat attribute name on `cmd`; dotted names (`util.cbag`, `movie.produce`) resolve by
  splitting on `.` — the same namespace modules exported at `packages/engine/modules/pymol/api.py:487-489`.
* The dispatcher calls `getattr(cmd, m)(*a, **k)` **directly**. It never goes through
  `pymol.parsing.prepare_call`, so real JSON types survive (that path does no coercion at all —
  every value arriving from the PML parser is a `str`).
* `_self` is injected by the bridge; `quiet` defaults to `1` unless the caller sets it.
* Allow-list = symbols exported by `packages/engine/modules/pymol/api.py` ∪ `cmd.keyword`, minus a deny-list:
  `system`, `run`, `spawn`, `quit`, `_quit`, `cd`, and anything starting with `_`. Deny-listed
  symbols return `{kind:'NotAllowed'}` unless `--allow-unsafe` is passed, in which case the client
  must confirm per-call. `alias`/`extend`/`set_key`/`alter`/`iterate`/`label` remain allowed but
  are marked `unsafe` in the generated schema (they `eval` user strings).
* `t:'do'` exists **only** for the console widget. It returns `null` because `cmd.do` returns
  `None` and prints exceptions instead of raising (`packages/engine/modules/pymol/commanding.py:441-461`).
  **No UI action may use it.**

### 2.4 Event push

The bridge is the **sole consumer** of every drain API. This is not a style preference: both
`cmd._get_feedback()` and `cmd.get_setting_updates()` clear their queues as they read
(`packages/engine/modules/pymol/internal.py:593-606`, `packages/engine/modules/pymol/setting.py:440-447`), so a second consumer
silently steals updates.

Topics (`packages/protocol/src/topics.ts`, owned by WP-01):

| Topic | Payload | Source | Tier |
|---|---|---|---|
| `feedback` | `{lines: string[]}` | `cmd._get_feedback()` | 0 — real drain |
| `settings` | `{changed: Record<number, {type, value, text}>}` | `cmd.get_setting_updates()` | 0 — real drain |
| `progress` | `{value: number, busy?: string}` | `cmd.get_progress()` | 0 — real |
| `redisplay` | `{dirty: true}` | `p.getRedisplay()` | 0 — real |
| `objects` | panel snapshot (names, type, enabled, group, nest, reps, color, caption) | new `get_panel_snapshot` (WP-06) | 1 |
| `view` | `number[18]` | `cmd.get_view()` diff | 1 |
| `frame` | `{frame, state, nframes, playing}` | `cmd.get_frame/get_state/count_frames/get_movie_playing` diff | 1 |
| `scenes` | `{names: string[], current: string}` | `cmd.get_scene_list()` diff | 1 |
| `selection` | `{names: string[], counts}` | `cmd.get_names('selections')` diff | 1 |
| `wizard` | `{depth, prompt, panel, eventMask}` | `cmd.get_wizard()` pull | 1 |
| `editor` | `{pk1..pk4, bondMode, nFrag}` | pk-selection diff | 1 |
| `geometry` | `{object, state, rep, level}` | invalidation callback (WP-06) | 2 |
| `colors` | `{revision}` | invalidated on `set_color`/`space`/`ramp_new`/`load` | 1 |
| `movie_panel` | per-row spec levels | new `get_movie_panel` (WP-06) | 2 |
| `seqview` | sequence-viewer model | new `get_seq_view` (WP-06) | 2 |
| `dialog` | `{kind, id, payload}` — blocking prompt from Python | `shims.py` | 1 |

**Tiering** (borrowed from the `cmd-api-rpc` map's analysis, which established that
`grep -r Notify layer0..layer5` returns zero hits — the C core has no event bus):

* **Tier 0** — genuine drains/pulls. Available today against an unmodified backend.
* **Tier 1** — shadow-snapshot diffing on the PyMOL thread. Gated: the diff only runs when
  (a) `getRedisplay()` was true, or (b) a mutating call just completed. Idle cost ≈ 0.
* **Tier 2** — requires WP-06's C additions. `get_change_counters()` (8 integers) turns Tier-1
  diffing from O(objects) into an integer compare and is the highest-value item in WP-06 after the
  geometry accessor itself.

**Pump cadence** (`pymol_bridge/pump.py`): 0 ms immediately after any `call`/`do` completes
(mirroring the Qt behaviour of re-arming the feedback timer at 0 ms:
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:391-394`), then backing off 4 ms → 16 ms → 100 ms → 250 ms while
idle. The Qt front-end's flat 500 ms poll is explicitly **not** cloned; it would add half a second
of lag to every menu checkmark.

**Coalescing.** `view`, `frame`, `progress` and `redisplay` are last-write-wins per tick.
`feedback` and `settings` are append-only and never dropped. Each topic carries a monotonic `seq`
so the client can detect a gap and force a resync.

### 2.5 Feedback streaming

Feedback is one undifferentiated text stream: `packages/engine/modules/pymol/colorprinting.py` assigns `error`,
`warning`, `suggest` and `parrot` all directly to `print`, so severity is lost before it reaches
the Ortho queue.

**Decision:** the bridge tags severity *heuristically* at the boundary (a line matching
`^\s*\w*-?Error:` → error; `Warning:` → warning; leading `\033[` ANSI → coloured) and marks the
tag `inferred: true` in the payload. The client renders inferred tags with a subtler treatment
than confirmed ones. Adding real severity sentinels to `colorprinting` is out of scope here
(it would be a `packages/engine/modules/` edit) and is recorded as a follow-up.

Console requirements from the `qt-main-window` map that must survive: HTML escaping equivalent to
`colorprinting.text2html` (escape `&<>`, spaces → nbsp, `\n` → line break), auto-scroll only when
already at the bottom, selectable text, and monospace with a user-settable font size.

### 2.6 Geometry streaming

**The contract: PyMOL computes, the browser draws.** three.js never derives geometry from atoms.

**Request/response.** Geometry is pulled, not pushed. The client receives a `geometry` event
(`{object, state, rep, level}`) and issues `t:'geom'`:

```ts
interface GeometryRequest {
  object: string;
  state: number;              // 1-based; 0 = current
  reps?: RepName[];           // default: all active reps on that coordset
  mode: 'impostor' | 'triangles';   // 'triangles' runs CGOSimplify server-side
  have?: Record<string, string>;    // rep → content hash the client already holds
}
interface GeometryResponse {
  object: string; state: number;
  reps: Array<
    | { rep: 'surface'; hash: string; counts: {verts: number; tris: number};
        blobs: { V: Blob32; VN: Blob32; VC: Blob32; VA: Blob32; VAO: Blob32;
                 T: BlobI32; AT: BlobI32; Vis: BlobI32 } }
    | { rep: 'sphere'; hash: string; sphereMode: number; count: number;
        blobs: { instances: Blob32 } }        // [cx,cy,cz,r, r,g,b,a] × N
    | { rep: 'cylinder'; hash: string; count: number;
        blobs: { instances: Blob32 } }        // [o(3),axis(3),r,capbits, c1(4), c2(4)] × N
    | { rep: 'cgo'; hash: string;
        blocks: Array<{ mode: number; arraybits: number; nverts: number; data: Blob32 }> }
    | { rep: 'label'; hash: string; atlasBlobId?: string;
        items: Array<{ xyz: [number,number,number]; text: string; color: number;
                       relativeMode: number }> }
    | { rep: 'unsupported'; reason: 'callback' | 'volume' | 'slice' }
  >;
}
```

Design notes, each grounded in the `geometry-extraction` map:

* **Surface** ships as raw `RepSurface` vectors (`packages/engine/layer2/RepSurface.cpp:59-101`, verified above):
  `V`→position, `VN`→normal, `VC`+`VA`→RGBA colour, `T`→index, `VAO`→`a_Accessibility`,
  `AT`→picking id. The client must replicate the per-triangle `visibility_test` cull.
* **CGO** ships as the interleaved `CGO_DRAW_ARRAYS` block that `CGOCombineBeginEnd` already
  produces (`packages/engine/layer1/CGO.cpp:1645-1672`): `[vertex 3n][normal 3n][color 4n][pickcolor 3n]
  [accessibility 1n]`, header `{mode, arraybits, narrays, nverts}`. Cartoon is already in this
  form before any GL (`packages/engine/layer2/RepCartoon.cpp:4287-4300`). This maps 1:1 to a three.js
  `InterleavedBuffer`.
* **Spheres and cylinders** ship as *impostor instance data*, not meshes, and the client ports
  `packages/engine/data/shaders/sphere.{vs,fs}` and `packages/engine/data/shaders/cylinder.{vs,fs}` (present on disk, verified
  §0). `sphere.fs` writes `gl_FragDepth` → **WebGL2 required, no WebGL1 fallback**.
  `mode: 'triangles'` is the escape hatch: the bridge runs `CGOSimplify`
  (`packages/engine/layer1/CGO.cpp:4444`) server-side and ships baked triangles — bigger payload, zero client
  geometry math, used for debugging and for clients that fail the WebGL2 check.
* **Never read back a VBO.** `packages/engine/layer1/CGO.h:183-186` documents that the CPU copy is deliberately
  destroyed after upload. The accessor reads `primitiveCGO` / `preshader` / `ray` / the
  `RepSurface` vectors only.
* **Cartoon hazard.** `disposePreshaderCGO` frees the preshader at first GL render
  (`packages/engine/layer2/RepCartoon.cpp:83-89, 240`). In our process no GL render ever happens (§0.1), so the
  preshader survives — but WP-06 must assert this in a test, and `cmd.rebuild()` before extraction
  is the documented fallback.
* **Transport.** Blobs ≤ 256 KB ride the WebSocket as msgpack `bin`; larger ones become
  `{blobId}` fetched over `GET /blob/{id}` so a 40 MB surface cannot stall input.
* **Caching.** Every rep payload carries a content hash. The client sends `have` and the bridge
  replies `{unchanged: true}` for matches. Colour-only invalidation (`cRepInvColor`,
  `packages/engine/layer1/Rep.h:133-184`) re-ships only `VC`/`VA`.
* **Ray output is a bitmap, not geometry.** `cmd.ray` drives the 7800-line CPU ray tracer with
  features (`ray_trace_mode` cel shading/outlines, true shadows, interior colours) that have no GL
  path at all. The web client calls `cmd.ray()` + `cmd.png(prior=1)` server-side and displays the
  PNG. This is a **product constraint, not an implementation detail** — see §8.
* **Picking is authoritative server-side.** `SceneDoXYPick` renders a colour-index pass and reads
  back one pixel in the *backend* GL context (`packages/engine/layer1/ScenePicking.cpp:17-38,146-149`). We have no
  such context. Our picking is therefore client-side (three.js raycast against the same geometry
  PyMOL computed) and the resulting `(object, atomIndex[, atomIndex2])` is routed through
  `cmd.edit(...)` / `SelectorCreate`-equivalent Python so the editor state and wizards see exactly
  what they see today. The pick-colour encoding must be replicated bit-for-bit
  (`packages/engine/layer1/CGO.h:141-142`; sentinels `cPickableAtom` −1 … `cPickableThrough` −5) or selections
  silently land on the wrong atoms. This is WP-08's central risk.

---

## 3. Client architecture

### 3.1 Stack decisions

| Concern | Choice | One-line justification |
|---|---|---|
| Framework | **React 19 + TypeScript 5 (strict)** | Mandated by the brief; strict TS is the only defence against a 404-symbol generated API. |
| Bundler | **Vite 6** | Instant HMR for a 300-component UI; native ESM; first-class worker + GLSL asset handling. |
| Package manager | **pnpm 10 workspaces** | Mandated; strict node_modules stops packages importing undeclared deps, which is what keeps WP ownership real. |
| Task runner | **Turborepo** | Content-hash caching over `gen → build → test`; codegen is the expensive step and must not re-run. |
| State | **Zustand** (+ `useSyncExternalStore`) | State is *push*-driven and high-frequency (feedback lines, view floats at 60 Hz); Zustand gives per-selector subscriptions with no context re-render and no reducer boilerplate. Redux Toolkit = too much ceremony for 15 stores; TanStack Query = a request cache, and we have almost no request-shaped state. |
| 3D | **three.js r17x** + custom `ShaderMaterial`s | Mandated; we use it as a WebGL2 scene graph only — every material is a port of `packages/engine/data/shaders/*`. |
| Menus/popovers/dialogs | **Radix UI primitives** | Headless + accessible + real submenu/hover/typeahead semantics, which the PyMOL popup engine needs (0.25 s submenu delay, sticky mode). |
| Styling | **Tailwind CSS 4** + CSS variables for theming | `packages/engine/data/pmg_qt/styles/pymol.sty` has 3 rules — there is no design source of truth to copy, so we need a real token system. |
| Docking/panels | **dockview** | Reproduces Qt's docked/floating/tabbed dock widgets, which the External GUI and Builder panels are. |
| Tables/lists | **TanStack Table + TanStack Virtual** | 779 settings, 5388 colours, 10⁵-residue sequences — virtualization is not optional. |
| Code editor | **CodeMirror 6** | Small, themeable, and we must author a PML language mode (ported from `packages/engine/modules/pmg_qt/syntax/`). |
| Serialization | **@msgpack/msgpack** | Matches the bridge; decodes `bin` straight into `Uint8Array` with no copy. |
| Unit tests | **Vitest** | Same transform pipeline as Vite; no second config. |
| E2E / parity | **Playwright** | Needed for real WebGL, real clipboard, real drag-and-drop, and screenshot diffing. |
| Component inventory | **Storybook 8** | The parity matrix (§7) needs one addressable story per Qt widget. |

### 3.2 `@pymol/protocol`

Zero-runtime-dependency package holding *only* types + topic constants + the msgpack codec
config. Both `@pymol/client` and the bridge's test suite validate against it. It is the contract
boundary; changing it is a deliberate, reviewable act.

### 3.3 `@pymol/client` — the typed cmd client

```ts
const client = await connect({ url: 'ws://127.0.0.1:8765/ws', token });

await client.cmd.load('/abs/path/1ubq.pdb', { object: 'x' });
const view = await client.cmd.get_view();          // View18 (tuple of 18 numbers)
await client.batch([
  ['set', ['transparency_mode', 3]],
  ['set', ['backface_cull', 0]],
  ['set', ['two_sided_lighting', -1]],
]);
client.on('settings', ({ changed }) => settingsStore.apply(changed));
```

* `src/transport.ts` — WS lifecycle, msgpack framing, id allocation, request map, reconnect with
  full state resync, backpressure (bounded outbound queue; input events are coalesced, calls are
  not).
* `src/generated/cmd.ts` — one wrapper per API symbol. Generated by `tools/gen-api`, which runs
  `extract.py` **inside `pymol -cq`** and reflects over `dir(cmd)` with `inspect.signature`.
  Type inference priority: explicit annotation (only a handful exist in the whole API) →
  `cmd.auto_arg` domain (`selection`, `color`, `object`, `setting`, `representation`, `scene`, …)
  → default-value type → docstring `ARGUMENTS` parsing → name heuristic → `ApiValue` union.
  Return types come from a hand-maintained override table (`tools/gen-api/overrides.ts`).
* Signature shape: required positionals first, then a single optional options object collapsing
  every defaulted/keyword-only parameter. `_self` is dropped.
* Commands whose parser mode is `LITERAL1`/`LITERAL2`/`PYTHON`/`SECURE` (they `eval` user strings)
  are emitted into `src/generated/unsafe.ts`, so importing one is a greppable decision.
* **CI regenerates and fails on drift.** This is the only defence against client/backend skew.

### 3.4 `@pymol/stores` — state management

One Zustand store per PyMOL concern, each fed by exactly one topic, each exposing selectors:

| Store | Fed by | Notable rule |
|---|---|---|
| `settings` | `settings` topic + one bulk fetch at connect | The **only** source of truth for every checkbox/radio in every menu. |
| `objects` | `objects` topic | Holds the flat panel rec array; the tree is derived, and the "cloaked" state (enabled object inside a disabled group) is re-derived client-side. |
| `feedback` | `feedback` topic | Ring buffer, 5000 lines, `atBottom` flag for autoscroll. |
| `view` | `view` topic + local camera | Bidirectional: client writes `set_view` on user camera moves, server pushes on animate/rock/scene recall. Conflict rule in §3.6. |
| `movie` / `scenes` | `frame`, `scenes`, `movie_panel` | The backend is the movie clock; the client never runs a frame timer. |
| `wizard` | `wizard` topic | Renders `get_panel()` rows generically; never interprets `code`. |
| `editor` | `editor` topic | Drives every Builder button's pick-state branching. |
| `colors` | `colors` topic | Palette cache keyed by index, invalidated wholesale on `cmd.space`. |
| `ui` | local only | Dock layout, panel visibility, fonts, "don't ask again" flags. Persisted to `localStorage`. |

**Nothing is optimistic** except pure-UI state. Every PyMOL mutation is round-tripped, because a
setting write can silently no-op at the wrong level and because `SettingGenerateSideEffects` can
invalidate geometry.

### 3.5 `@pymol/viewport` — the three.js layer

```
<Viewport>
  ├─ <canvas>              WebGL2, three.js Scene
  │   └─ root Group        ← cmd.get_view()[0..8] rotation + [12..14] model origin
  │       └─ per-object Group  ← cmd.get_object_matrix (matrix_mode)
  │           └─ per-rep Object3D  (Mesh | InstancedMesh | LineSegments | Points)
  └─ overlay layer (absolutely-positioned DOM, NOT drawn in three.js)
      ├─ <WizardPrompt/>   <SceneButtons/>   <SelectionMarquee/>
      ├─ <BusyOverlay/>    <SplashBanner/>   <LabelLayer/> (if CSS-label mode)
      └─ <SeqViewOverlay/> (when seq_view_location = top/bottom)
```

* **Camera.** `cmd.get_view()` returns 18 floats: `[0..8]` column-major model→camera rotation,
  `[9..11]` origin in camera space, `[12..14]` origin in model space, `[15]` front clip,
  `[16]` rear clip, `[17]` signed ortho flag / FOV. This maps directly onto a three.js
  `PerspectiveCamera`/`OrthographicCamera` plus a root `Group` transform. `cmd.set_view` requires
  **exactly 18** floats while the C getter returns 25 — the slice is a known silent-bug hazard and
  lives in exactly one file with a golden test.
* **Materials.** `packages/viewport/src/materials/*` are ports of `packages/engine/data/shaders/*`, generated into
  `shaders/generated/*.glsl.ts` by `tools/gen-shaders`. Port order: `default` → `surface` →
  `sphere` → `cylinder` → `line`/`trilines` → `ramp` → `label` → `oit`.
* **Geometry cache.** Keyed `${object}|${state}|${rep}` → `{hash, BufferGeometry, disposers}`.
  A `geometry` event with `level === cRepInvColor` swaps only the colour attribute.
* **What is NOT in three.js:** the object panel, movie panel, mouse-mode block, wizard panel,
  wizard prompt, scene buttons, command prompt, feedback scrollback, busy box, splash and
  selection marquee. In PyMOL all of these are drawn by the Ortho layer *inside the GL viewport*.
  In the web client they are all DOM. This is the single largest structural change from the
  original, and it means `internal_gui_width`, `internal_gui_control_size` and `internal_gui_mode`
  become *hints* the CSS layout honours for session round-trip parity, not layout drivers.

### 3.6 Camera round-trip policy

Localhost RTT is ~1–3 ms. **Default: full round-trip** — pointer events go to the bridge, the
bridge runs the real trackball math (`packages/engine/layer1/SceneMouse.cpp:1774-1854`, three
`virtual_trackball` formulations, `mouse_scale`/`mouse_limit` clamping), and the resulting view
comes back as a `view` event. Client-side prediction is available behind a flag for `rota`/`move`/
`movz` only, implemented in one file with golden-value tests against the C. **Prediction must
never leak into a pick**, because picks are resolved against the authoritative view.

### 3.7 Client-side picking

The one place where we deviate structurally. PyMOL picks by rendering a colour-index pass in its
own GL context; we have none. Instead:

1. three.js raycasts the *same* geometry PyMOL computed, decoding the pick-colour sub-block of the
   CGO arrays / `RepSurface.AT` to recover `(objectName, atomIndex)` or, for bond picking,
   `(objectName, atomIndex1, atomIndex2)`.
2. The client sends `t:'input', ev:{kind:'pick', …}`.
3. The bridge reproduces the C editor work (`cmd.edit(...)`, `pk1`/`pkmol`/`pkresi` creation) and
   then calls the wizard hooks `do_pick_state(state)` / `do_pick(bondFlag)` /
   `do_select(name)` in the same order the C does.

Consequence: **bond picking must exist in the client picker from day one** — `ValenceWizard` and
`UnbondWizard` switch the mouse into `PkBd` mode and are unusable without it.

---

## 4. Shell and layout

### 4.1 The window

```
┌───────────────────────────────────────────────────────────────────────────┐
│ MenuBar   File Edit Build Movie Display Setting Scene Mouse Wizard Plugin Help │
├───────────────────────────────────────────────────────────────────────────┤
│ ExternalGuiPanel (dockable: top | left | right | floating | hidden)        │
│  ┌ FeedbackConsole (virtualized, monospace) ──────────────────────────┐    │
│  │                                                                    │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│  PyMOL> [CommandInput  history · tab-complete · drag-preview]              │
│  QuickButtons  row1 Reset Zoom Orient Draw/Ray | row2 Unpick Deselect …    │
│  ProgressBar ▓▓▓▓▓░░░░  [Abort]                                            │
├──────────────────────────────────────────────┬────────────────────────────┤
│ SeqViewOverlay (when seq_view_location=top)  │  InternalGuiColumn         │
│ ┌──────────────────────────────────────────┐ │  ┌ ObjectPanel ──────────┐ │
│ │                                          │ │  │ all      A S H L C M  │ │
│ │        Viewport  <canvas> WebGL2         │ │  │ ▾ grp1                │ │
│ │                                          │ │  │   1ubq   A S H L C    │ │
│ │  overlays: WizardPrompt · SceneButtons · │ │  │   (sele) A S H L C    │ │
│ │  Marquee · Busy · Splash                 │ │  └───────────────────────┘ │
│ │                                          │ │  ┌ WizardPanel ──────────┐ │
│ └──────────────────────────────────────────┘ │  └───────────────────────┘ │
│ MovieTimeline (rows: camera + per object)    │  ┌ ButModeBlock ─────────┐ │
├──────────────────────────────────────────────┤  └───────────────────────┘ │
│ ControlBar |< < ■ ▶ > >| S ⟳ ⛶               │  ┌ ControlBar (gutter) ──┐ │
└──────────────────────────────────────────────┴────────────────────────────┘
```

CSS grid at the root. The dockable `ExternalGuiPanel` uses **dockview**; the
`InternalGuiColumn` is a plain resizable flex column whose width writes back to
`internal_gui_width` (so `.pse` round-trips), with the double-click collapse/restore behaviour
preserved.

### 4.2 Mapping table: Qt/Ortho surface → React component

| Original | Where it lived | React component | Owner WP |
|---|---|---|---|
| `QMainWindow` + docks | `pmg_qt/pymol_qt_gui.py:88` | `shell/AppShell.tsx` + `Docking.tsx` | WP-09 |
| Menu bar (`_addmenu` grammar) | `pymol/_gui.py:55` consumed at `pymol_qt_gui.py:353` | `features/menubar/*` + `@pymol/menu-data` | WP-11 |
| External GUI frame | `pymol_qt_gui.py:171` | `shell/ExternalGuiPanel.tsx` | WP-09 |
| Command line | `pymol_qt_gui.py:1087` | `features/console/CommandInput.tsx` | WP-14 |
| Feedback browser | `pymol_qt_gui.py:941` | `features/console/FeedbackLog.tsx` | WP-14 |
| Quick buttons + progress | `pymol_qt_gui.py:222` | `features/console/QuickButtons.tsx` | WP-14 |
| Object list (Executive block) | `packages/engine/layer3/Executive.cpp:16116` | `features/objects/*` | WP-12 |
| A/S/H/L/C/M popups | `packages/engine/layer4/PopUp.cpp` + `pymol/menu.py` | `features/pymol-menu/*` | WP-13 |
| Wizard panel + prompt | `packages/engine/layer1/Wizard.cpp:227`, `packages/engine/layer1/Ortho.cpp:2124` | `features/wizards/*` | WP-15 |
| ButMode block | `packages/engine/layer1/ButMode.cpp:192` | `features/keyboard/MouseModeBlock.tsx` | WP-22 |
| Control bar (9 buttons) | `packages/engine/layer1/Control.cpp:298` | `features/movie/ControlBar.tsx` | WP-19 |
| Movie timeline | `packages/engine/layer1/Movie.cpp:1741` | `features/movie/MovieTimeline.tsx` | WP-19 |
| Scene buttons overlay | `packages/engine/layer1/Scene.cpp:2885` | `features/scenes/SceneButtons.tsx` | WP-19 |
| Sequence viewer | `packages/engine/layer3/Seeker.cpp:969` | `features/seqview/*` | WP-20 |
| In-viewport CLI + scrollback | `packages/engine/layer1/Ortho.cpp:841`, `:1623` | folded into `features/console/*` | WP-14 |
| Builder panel | `pmg_qt/builder.py:1031` | `features/builder/*` | WP-16 |
| Render (Draw/Ray) panel | `pymol_qt_gui.py:673` | `features/render/*` | WP-18 |
| File dialogs | `pmg_qt/file_dialogs.py` | `features/files/*` | WP-17 |
| Colors editor | `pymol_qt_gui.py:547` | `features/colors/*` | WP-21 |
| Advanced settings | `pmg_qt/advanced_settings_gui.py:13` | `features/settings/AdvancedTable.tsx` | WP-10 |
| Volume ramp editor | `pmg_qt/volume.py:811` | `features/dialogs/Volume*` | WP-21 |
| Properties inspector | `pmg_qt/properties_dialog.py:119` | `features/dialogs/Properties*` | WP-21 |
| Scene panel | `pmg_qt/scene_bin_gui.py:29` | `features/scenes/ScenePanel.tsx` | WP-19 |
| Shortcut editor | `pmg_qt/shortcut_menu_gui.py:43` | `features/shortcuts/*` | WP-22 |
| Text editor (pymolrc) | `pmg_qt/TextEditor.py:18` | `features/dialogs/TextEditor.tsx` | WP-21 |

### 4.3 Blocking Python dialogs

`ask_partial` (`file_dialogs.py:88`) uses `exec()`, and the tkinter shim
(`pmg_qt/mimic_tk.py:36-90`) blocks the calling Python thread. The bridge implements this with a
`dialog` event + a `Future` resolved by the client's answer. **The request must be issued from a
worker thread, never the single PyMOL thread**, or the pump deadlocks and the UI freezes. This is
a hard rule and gets a dedicated test in WP-02.

---

## 5. Work packages

**Ownership rule:** every file in the tree has exactly one owning WP. Two agents never write the
same file. Where a package needs a type from another package's file, it goes through the public
`index.ts` export, not by editing the other package.

**Legend:** `sizeAgents` = concurrent agents the package can absorb without them colliding.

### Wave 0 — foundation (must land before anything else)

| WP | Title | Depends on | Agents |
|---|---|---|---|
| **WP-00** | Monorepo scaffold + dev tooling | — | 1 |
| **WP-01** | `@pymol/protocol` wire contract | — | 1 |
| **WP-02** | Bridge core: process model, WS, dispatch, auth | WP-01 | 2 |

### Wave 1 — the two spines

| WP | Title | Depends on | Agents |
|---|---|---|---|
| **WP-03** | Bridge event pump (feedback / settings / progress / snapshots) | WP-02 | 2 |
| **WP-04** | API schema extraction + TS codegen | WP-00, WP-02 | 1 |
| **WP-05** | `@pymol/client` transport + typed cmd | WP-01, WP-04 | 2 |
| **WP-06** | Native geometry accessor (`packages/engine/layer4/CmdWebGeometry.cpp`) + bridge extractor | WP-02 | 2 |
| **WP-09** | App shell, docking, routing, theme tokens | WP-00 | 2 |

### Wave 2 — viewport + core UI

| WP | Title | Depends on | Agents |
|---|---|---|---|
| **WP-07** | `@pymol/viewport` scene, camera, materials, geometry cache | WP-05, WP-06 | 3 |
| **WP-08** | Input + picking (mouse, wheel, gestures, pick routing) | WP-07, WP-03 | 2 |
| **WP-10** | Settings store + settings UI (menu items, advanced table, lighting) | WP-05, WP-03 | 2 |
| **WP-11** | Menu descriptor extraction + menu bar | WP-04, WP-09, WP-10 | 2 |
| **WP-12** | Object panel (tree, toggles, drag semantics) | WP-05, WP-03, WP-13 | 2 |
| **WP-13** | PyMOL popup-menu engine (`pymol.menu` over the wire) | WP-05, WP-09 | 1 |
| **WP-14** | Console: command line, completion, feedback log, quick buttons | WP-05, WP-03, WP-09 | 2 |

### Wave 3 — feature surfaces (fully parallel)

| WP | Title | Depends on | Agents |
|---|---|---|---|
| **WP-15** | Wizards (generic panel/prompt/menu + 26 wizard modules) | WP-13, WP-08 | 2 |
| **WP-16** | Builder | WP-15, WP-08 | 2 |
| **WP-17** | File I/O: server file picker, load/save/export, fetch, drag-drop | WP-05, WP-09 | 3 |
| **WP-18** | Render pipeline: Draw/Ray panel, PNG streaming, clipboard | WP-05, WP-07 | 1 |
| **WP-19** | Movies, scenes, states: transport, timeline, scene panel/buttons | WP-05, WP-06, WP-09 | 3 |
| **WP-20** | Sequence viewer | WP-06, WP-12 | 2 |
| **WP-21** | Dialogs: volume ramp, properties, colors, text editor | WP-05, WP-09, WP-10 | 3 |
| **WP-22** | Keyboard: key translation, key map, shortcut editor, mouse config | WP-05, WP-08 | 2 |

### Wave 4 — quality gate

| WP | Title | Depends on | Agents |
|---|---|---|---|
| **WP-23** | Parity harness + golden fixtures + CI | WP-00, and incrementally all | 2 |
| **WP-24** | Packaging, `pymol --web` entry point, docs | WP-02, WP-09 | 1 |

Full file-ownership lists, scope statements and acceptance criteria are in the structured
`workPackages` return value that accompanies this document; the table above is the dependency
graph.

### 5.1 Cross-cutting ownership rules

* `packages/protocol/src/envelope.ts`, `topics.ts`, `errors.ts` → **WP-01 only**.
  `geometry.ts` → **WP-06 only**. `panels.ts` → **WP-12 only**. Same package, disjoint files.
* `packages/client/src/generated/**` is **never hand-edited**; it is `tools/gen-api` output and
  `tools/gen-api/*` is owned by WP-04.
* `packages/ui/src/*` is owned by WP-09. Feature WPs may compose but not edit those primitives; a
  needed primitive is requested from WP-09.
* `packages/engine/layer4/CmdWebGeometry.cpp` and the `packages/engine/layer4/Cmd.cpp` method-table insertion are **WP-06 only**.
  No other WP touches any file outside `webclient/`.
* `apps/web/src/App.tsx` and `main.tsx` are WP-09's. Feature WPs register through
  `apps/web/src/features/<name>/register.ts`, which WP-09's shell imports via a generated barrel.

---

## 6. Exact file contents

### 6.1 `webclient/pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'tools/*'

catalog:
  react: ^19.1.0
  react-dom: ^19.1.0
  '@types/react': ^19.1.0
  '@types/react-dom': ^19.1.0
  three: ^0.171.0
  '@types/three': ^0.171.0
  zustand: ^5.0.3
  '@msgpack/msgpack': ^3.0.0
  typescript: ^5.7.3
  vite: ^6.0.0
  vitest: ^2.1.8
  '@vitejs/plugin-react': ^4.3.4

onlyBuiltDependencies:
  - esbuild
```

### 6.2 `webclient/package.json`

```json
{
  "name": "@pymol/webclient",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.4.1",
  "engines": { "node": ">=20.11.0", "pnpm": ">=10" },
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "dev:web": "pnpm --filter @pymol/web dev",
    "dev:bridge": "python -m pymol_bridge --port 8765 --reload",
    "bootstrap": "bash scripts/bootstrap.sh",
    "doctor": "node scripts/doctor.mjs",
    "gen": "turbo run gen",
    "gen:api": "pnpm --filter @pymol/gen-api run gen",
    "gen:menus": "pnpm --filter @pymol/gen-menus run gen",
    "gen:shaders": "pnpm --filter @pymol/gen-shaders run gen",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:py": "python -m pytest packages/bridge/tests -q",
    "test:e2e": "pnpm --filter @pymol/web exec playwright test",
    "parity": "node tools/parity/check.mjs",
    "storybook": "pnpm --filter @pymol/web storybook",
    "ci": "pnpm gen && pnpm typecheck && pnpm lint && pnpm test && pnpm test:py && pnpm parity"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "turbo": "^2.3.3",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

### 6.3 `webclient/tsconfig.base.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "useUnknownInCatchVariables": true,

    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true,

    "baseUrl": ".",
    "paths": {
      "@pymol/protocol": ["packages/protocol/src/index.ts"],
      "@pymol/protocol/*": ["packages/protocol/src/*"],
      "@pymol/client": ["packages/client/src/index.ts"],
      "@pymol/client/*": ["packages/client/src/*"],
      "@pymol/stores": ["packages/stores/src/index.ts"],
      "@pymol/viewport": ["packages/viewport/src/index.ts"],
      "@pymol/menu-data": ["packages/menu-data/src/index.ts"],
      "@pymol/ui": ["packages/ui/src/index.ts"],
      "@pymol/testing": ["packages/testing/src/index.ts"]
    }
  },
  "exclude": ["node_modules", "dist", "**/generated/**/*.js"]
}
```

### 6.4 `webclient/scripts/dev.mjs` — the dev script

One command starts everything: preflight, bridge, codegen (if stale), Vite. Colour-prefixed
interleaved logs, single Ctrl-C tears down both, and the bridge's death kills Vite so you never
debug a UI talking to a dead engine.

```js
#!/usr/bin/env node
// webclient/scripts/dev.mjs  — owned by WP-00
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');              // webclient/
const REPO = resolve(ROOT, '..');              // pymol source root
const PY   = process.env.PYMOL_PYTHON ?? 'python3';
const PORT = process.env.PYMOL_BRIDGE_PORT ?? '8765';
const TOKEN = process.env.PYMOL_BRIDGE_TOKEN ?? randomBytes(32).toString('hex');

const children = [];
let dying = false;

function run(name, colour, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
    env: { ...process.env, ...opts.env } });
  const tag = `\x1b[${colour}m[${name}]\x1b[0m `;
  const pipe = (s, out) => s.on('data', b =>
    String(b).split('\n').filter(Boolean).forEach(l => out.write(tag + l + '\n')));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code, sig) => {
    if (dying) return;
    process.stdout.write(tag + `exited (code=${code} signal=${sig}) — shutting down\n`);
    shutdown(code ?? 1);
  });
  children.push(p);
  return p;
}

function shutdown(code = 0) {
  if (dying) return;
  dying = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// ── 0. preflight ───────────────────────────────────────────────────────────
const check = spawn(PY, ['-c', 'import pymol, pymol_bridge'], { stdio: 'inherit' });
check.on('exit', code => {
  if (code !== 0) {
    console.error(
      `\n  PyMOL or pymol-bridge is not importable with "${PY}".\n` +
      `  Run:  pnpm bootstrap        (builds ${REPO} and installs webclient/bridge)\n`);
    process.exit(1);
  }
  start();
});

function start() {
  // ── 1. codegen if the schema is missing (turbo caches the rest) ──────────
  const schema = resolve(ROOT, 'packages/client/src/generated/schema.json');
  const gen = existsSync(schema)
    ? Promise.resolve()
    : new Promise(res => run('gen', '35', 'pnpm', ['run', 'gen']).on('exit', res));

  gen.then(() => {
    // ── 2. the PyMOL bridge ───────────────────────────────────────────────
    run('bridge', '36', PY,
      ['-m', 'pymol_bridge', '--port', PORT, '--token', TOKEN, '--reload'],
      { cwd: REPO, env: { PYTHONUNBUFFERED: '1' } });

    // ── 3. the React app ──────────────────────────────────────────────────
    run('web', '32', 'pnpm', ['--filter', '@pymol/web', 'dev'], {
      env: {
        VITE_PYMOL_BRIDGE_URL: `ws://127.0.0.1:${PORT}/ws`,
        VITE_PYMOL_BRIDGE_HTTP: `http://127.0.0.1:${PORT}`,
        VITE_PYMOL_BRIDGE_TOKEN: TOKEN,
      },
    });

    console.log(`\n  bridge  ws://127.0.0.1:${PORT}/ws\n  web     http://127.0.0.1:5173\n`);
  });
}
```

### 6.5 `webclient/turbo.json` (supporting)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "gen":       { "cache": true, "outputs": ["src/generated/**", "generated/**"] },
    "build":     { "dependsOn": ["^build", "gen"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build", "gen"] },
    "lint":      { "dependsOn": ["gen"] },
    "test":      { "dependsOn": ["^build", "gen"] },
    "dev":       { "cache": false, "persistent": true }
  }
}
```

### 6.6 `webclient/.gitignore` (supporting)

```
node_modules/
dist/
.turbo/
*.tsbuildinfo
playwright-report/
test-results/
.venv/
__pycache__/
**/generated/**
!**/generated/.gitkeep
```

---

## 7. Parity testing strategy

Parity is verified **mechanically**, at four levels. The rule: *a feature that is not in the
parity matrix does not exist.*

### 7.1 Level 1 — the parity matrix (coverage, not correctness)

`tools/parity/extract-features.mjs` parses the twelve area maps in `docs/*.md` and emits
`webclient/parity/matrix.json`: one row per mapped feature, keyed by `{area, name, sourceRef}`.
Every row must be claimed by exactly one of:

| Status | Meaning |
|---|---|
| `implemented` | A test id in `parity/claims/*.json` proves it. |
| `deferred` | Explicit, with an owner and a reason. |
| `dropped` | Explicit, with a reason (e.g. `stereo quadbuffer: no WebGL equivalent`). |
| `unclaimed` | **CI fails.** |

`pnpm parity` fails the build on any `unclaimed` row. This is what turns 300+ mapped features into
a checklist that cannot silently shrink.

### 7.2 Level 2 — command-trace equivalence (the primary correctness gate)

This is the sharpest tool available, and it works because both front-ends ultimately speak the
same language: `cmd` calls.

1. **Record from Qt.** A recorder (`packages/bridge/tests/record_qt.py`) opens `cmd.log_open(f, 'w')` —
   which logs every menu/checkbox/button action, because the Qt menu builder calls
   `cmd.set(name, value, log=1, quiet=0)` and command items go through `cmd.do` — then a human (or
   a scripted Qt driver) performs a scenario. Output: `parity/traces/<scenario>.pml`.
2. **Replay in React.** A Playwright spec drives the equivalent React interaction with the bridge
   in *trace mode*, which appends every dispatched `{m, a, k}` to a trace file.
3. **Compare.** `tools/parity/check.mjs` normalises both traces (canonical arg order, numeric
   tolerance, ignore `quiet`/`log`) and diffs them.

A React menu item that fires `cmd.set('cartoon_fancy_helices', 1)` where Qt fires
`cmd.set('cartoon_fancy_helices', 1, log=1, quiet=0)` passes. One that fires the wrong setting
index, the wrong true/false pair, or three calls where Qt fired one, fails with a readable diff.

Seed scenarios (one per area, expanded per WP): load-and-show, every Setting-menu leaf, every
Display-menu leaf, object-panel toggle/drag/group, scene store/recall/reorder, movie program
add + update + remove, builder fragment attach, each wizard's happy path, each file dialog.

### 7.3 Level 3 — state-snapshot equivalence

For each scenario, after replay, both sides dump a canonical state snapshot:
`{settings: all 779 values, objects: get_names/get_type/get_vis, view: get_view(),
frame/state, scenes: get_scene_list(), selections}`. Byte-compare after normalisation. This catches
"the right command with the wrong argument" and "the right result reached by the wrong path".

### 7.4 Level 4 — visual parity

* **Ray parity is exact and free:** both front-ends call the same `cmd.ray` + `cmd.png`, so
  ray-rendered images must match **pixel-for-pixel**. Any drift is a backend bug, not a UI bug.
  This gives us a free, high-signal regression suite over the whole scene state.
* **GL parity is approximate:** three.js output is compared to `cmd.draw` output with a perceptual
  diff and a documented per-rep tolerance budget (surfaces tight, transparency loose, labels
  loosest, anti-aliasing excluded). Regressions are measured against the previous three.js output,
  not against Qt.
* **Widget parity is structural, not pixel:** each Qt widget gets a Storybook story plus a
  checklist test asserting the *inventory* — every button label, every menu leaf, every field, tab
  order, enable/disable rules, and default values — extracted from the area map. We are not
  cloning Qt's native theme; `packages/engine/data/pmg_qt/styles/pymol.sty` has three rules, so there is nothing to
  clone.

### 7.5 Level 5 — generated-API drift

CI re-runs `tools/gen-api/extract.py` inside `pymol -cq` and fails if
`packages/client/src/generated/schema.json` differs from the committed one. Same for
`tools/gen-menus` and `tools/gen-shaders`. Without this the typed client silently rots against the
backend.

### 7.6 Test placement

| Kind | Location | Runner |
|---|---|---|
| Bridge unit/integration | `webclient/bridge/tests/` | pytest |
| Protocol/client/stores unit | `packages/*/src/**/*.test.ts` | Vitest |
| Shader/math golden values | `packages/viewport/src/**/__goldens__/` | Vitest |
| Component inventory | `apps/web/src/**/*.stories.tsx` + `*.test.tsx` | Vitest + Testing Library |
| E2E + parity replay | `apps/web/e2e/**` | Playwright |
| Parity matrix | `webclient/parity/` | `node tools/parity/check.mjs` |

---

## 8. Top risks (ranked)

1. **`pmgui` vs `HaveGUI` (§0.1).** If running with `pmgui=1` and never drawing turns out to be
   unstable over a long session, the whole event story collapses. Mitigated by making it WP-02's
   first acceptance test.
2. **Geometry requires new C++.** No existing export path is usable as a feed. WP-06 is on the
   critical path for the entire viewport, and it is C++ work in a tree we otherwise treat as
   read-only.
3. **Picking has no server-side equivalent.** PyMOL picks with a GPU colour-index pass in a
   context we do not have. Getting the pick-colour bit layout wrong produces selections that land
   on the wrong atoms — a correctness bug that looks like a UI bug.
4. **Ray tracing can never match three.js.** `ray_trace_mode` cel-shading/outlines have no GL path
   at all. The product must accept "interactive = WebGL, publication = server-rendered bitmap".
5. **Transparency will not match.** OIT mode 3 uses a multi-draw-buffer accumulation FBO; the other
   modes CPU-sort triangles every frame. Per-frame sorting of 10⁶ triangles in JS will not hold
   60 fps.
6. **Drain APIs are consume-once.** Exactly one consumer is allowed; a second one silently steals
   updates. Enforced by making the bridge the sole caller and never running a Qt window alongside.
7. **Input ordering and timing.** Single/double-click detection uses backend timestamps
   (0.35 s / 0.25 s / 0.15 s windows). Network jitter inflates the measured press→release gap and
   silently swallows single clicks unless the client timestamp is passed through as `when`.
8. **Browser keyboard hijacking.** PyMOL binds `CTRL-T`, `CTRL-F`, `CTRL-N`, `CTRL-W`; several
   cannot be `preventDefault`-ed. Needs a product decision (remap, capture mode, or PWA install).
9. **`cmd.do` is a black hole.** It returns `None` and prints exceptions. Any UI feature built on
   it is blind to failure. Enforced by restricting `t:'do'` to the console.
10. **Legacy Tk plugins cannot be ported.** `mimic_pmg_tk.PMGApp` creates a real hidden
    `tkinter.Tk()` root, and `mimic_tk.py` installs a global `sys.meta_path` hook that will still
    fire headlessly and hand plugins invisible dialogs.
11. **Generated types are ~70 % heuristic.** Only a handful of type annotations exist across 404
    API symbols. The return-type override table plus the §7.5 drift check are the only mitigation.
12. **Broken-in-open-source features.** `cmd.clean`, `cmd.load_mtz`, `.mae` load, `.mtl`/STL export
    all raise `IncentiveOnlyException` / "not implemented". Every affected UI surface must be
    disabled or must surface the error, not silently no-op.
13. **`cmd.viewport` resizes the *window*.** A browser cannot resize itself; `cmd.viewport w,h`
    must resize the canvas and report the achieved size back, which changes observable behaviour
    for scripts.
14. **RCE by design.** Wizard panel rows, popup-menu leaves and `t:'do'` all execute PyMOL command
    strings in the local process. Acceptable only under localhost + token + `Origin` allow-list;
    it must never bind to a non-loopback interface.

---

## 9. Decisions the product owner must make

1. **`File > New PyMOL Window`** (`os.spawnv`, two entry points) directly contradicts
   one-process/one-client. Hide, or spawn a second bridge on another port and open a tab?
2. **Stereo.** `quadbuffer`, `byrow` (Zalman) and `openvr` have no WebGL equivalent. Drop them, or
   reject with a feedback message? Anaglyph and side-by-side are portable.
3. **`cmd.clean`** is incentive-only here. Ship the Builder's Clean button disabled, or wire an
   open-source MMFF94 minimizer behind the same signature?
4. **Undo.** `editor.undocontext` is a no-op stub, so most "undoable" Builder actions are not
   undoable. Ship at open-source parity, or implement a real snapshot/restore undo in the bridge?
5. **Export destination default.** Browser download (via `get_bytes`/`get_str`/`png`) or write to a
   server path? Multi-file patterns and movie encoding force server paths; single files could go
   either way.
6. **`.pwg` files** start a second HTTP server and can launch arbitrary Python modules. Refuse
   outright, or allow behind a per-file confirmation?
7. **Legacy plugins.** Drop `Plugin > Legacy Plugins` and define a new React plugin API, or keep
   plugins headless and have them register JSON menu descriptors over the bridge?
8. **Movie timeline in v1?** It is the most expensive single surface (per-frame keyframe data plus
   eight modifier-dependent drag modes) and needs new backend accessors.
9. **`internal_gui_*` settings.** Honour them as CSS layout hints for session round-trip parity, or
   deprecate them in the web build and document the divergence?
10. **Upstream bug fidelity.** Clone the known upstream bugs (duplicate mouse-mode rows, the
    `'[N more]'` unset bug, swapped singular/plural wizard prompts, the `Chlorrine` typo) for
    byte-level fidelity, or fix them and maintain a documented divergence list?
11. **Client-side camera prediction.** Default off (full round-trip at 1–3 ms localhost RTT), or on
    for `rota`/`move`/`movz`?
12. **Recent files / shortcuts persistence.** Keep server-side (`~/.pymol/recent.db`,
    `~/.pymol/shortcuts_save.json`, shared with desktop PyMOL) or move to browser storage?

---

## 10. Open questions I could not resolve from the source

* Does `RepCartoon`'s preshader reliably survive in a process that never renders? The dispose path
  only swaps into `->ray` when `ray` is null, and I found no write to `I->ray` in `RepCartoonNew`.
  WP-06 must confirm at runtime.
* Exact byte layout of the pick-colour sub-block inside `cgo::draw::arrays`. The constants say
  RGBA precedes the index sub-array, but this needs a runtime dump before the client decodes it.
* Is `RepSurface::AT` populated in all surface modes, or only when `pick_surface` is on? Surface
  picking needs a fallback if it is conditional.
* How much of `packages/engine/data/shaders/` compiles unmodified under the `PURE_OPENGL_ES_2` preprocessor path?
  If the ES2 variant is already close to WebGL2-valid, shader porting drops from *hard* to
  *moderate* across the whole viewport.
* Does `pmg_qt/file_dialogs.load_dialog` call `recent_filenames_add`? If not, Open Recent only ever
  records saved sessions, and we would be cloning a bug.
* Whether a long-lived `pmgui=1` process that never draws leaks or degrades over a multi-hour
  session — needs a soak test in WP-02.
