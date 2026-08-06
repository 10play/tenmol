# Architecture

How tenmol works. This describes the system as built; where a detail lives in one file, that file
is named instead of restated.

tenmol is a fork of PyMOL whose Qt front-end has been replaced by a React app talking to a Python
bridge. The C++/Python engine is kept and driven, not reimplemented: every molecule, surface,
setting and ray-traced image is produced by the same code desktop PyMOL runs.

**Deployment model: local desktop replacement.** One PyMOL process, one browser, on `localhost`,
with full filesystem access. Not a multi-tenant server. This is load-bearing — the bridge executes
arbitrary local code by design (see [§6 The capability policy](#6-the-capability-policy)).

---

## 1. Process and threads

One process. Three threads, with strict rules about which may touch `cmd`.

```
browser ── ws://127.0.0.1:8765/ws ──▶  asyncio / uvicorn thread
                                         owns the socket, the framing, backpressure
                                         touches pymol.cmd: NEVER
                                            │ FIFO of tasks     ▲ futures
                                            ▼                   │
                                       ENGINE THREAD                       60 Hz
                                         offscreen GL context + one FBO
                                         pymol2.SingletonPyMOL
                                         drain FIFO → p.idle() → p.draw()
                                         tick hooks: Mode P readback, state tick
                                            ▲
                                       STATUS THREAD                       10 Hz
                                         cmd.get_progress()
                                         cmd._get_feedback()
                                         cmd.get_setting_updates()
```

**Why exactly one engine thread.** `cmd` is guarded by an API lock, and three of its drains fail
*silently* under contention rather than blocking: `cmd._get_feedback()` returns `None`
(`packages/engine/modules/pymol/internal.py`) and `cmd.get_setting_updates()` returns `[]`
(`packages/engine/modules/pymol/setting.py`) when `lock_attempt` fails. Worse, all viewport input
is queued through `OrthoDefer` with captured timestamps
(`packages/engine/layer1/Scene.cpp:4113-4155`), so reordering input corrupts drag state. A single
ordered thread makes both problems structurally impossible.

**Why the status thread exists anyway.** Those three calls are the only ones in the API that
*attempt* the lock instead of taking it, so they are the only ones safe to make from a second
thread. Running them off the engine thread is what keeps the console alive during a long `ray`.

`packages/bridge/README.md` is the reference for this layer. The bridge's Python package is
`packages/bridge/tenmol_bridge/`, and module paths below are written relative to it.

## 2. Boot order, and why it is not negotiable

`Engine.boot()` (`packages/bridge/tenmol_bridge/engine.py`) runs these steps in this order, on the
engine thread. Each one has a failure mode that is silent if it is skipped or reordered.

1. **Create the GL context first**, before `SingletonPyMOL().start()`. PyMOL adopts whatever
   framebuffer is bound at its first draw — `check_gl_stereo_capable` reads
   `GL_FRAMEBUFFER_BINDING` into `G->ShaderMgr->defaultBackbuffer.framebuffer`
   (`packages/engine/layer5/PyMOL.cpp:2236-2239`) — so our FBO must already be current on this
   thread.
2. **`options.no_gui = 0`.** Options are snapshotted into `CPyMOLOptions` at `_cmd._new`
   (`packages/engine/layer1/P.cpp:1800-1830`); setting them afterwards does nothing. `no_gui = 1`
   sets `pmgui = 0`, and `OrthoFeedbackIn` then drops every console message for the life of the
   process (`packages/engine/layer1/Ortho.cpp:492-499`). Never launch with `-c`/`-cq`.
   `internal_gui`, `internal_feedback` and `external_gui` are set to `0` here so that window
   coordinates equal viewport coordinates; with the defaults on, `reshape(640,480)` yields
   `get_viewport() == (420,462)` and every mouse coordinate the browser sends is wrong.
3. **`pymol2.SingletonPyMOL`, never `pymol2.PyMOL`.** `pcatch` writes through the file-scope
   `SingletonPyMOLGlobals` pointer (`packages/engine/layer1/P.cpp:2667`); with a non-singleton that
   pointer is null and every `print()` is silently discarded.
4. **Install `pcatch`**, so Python-origin output lands in the same line buffer as C-origin output,
   correctly interleaved.
5. **`pymol.glutThread = <engine thread ident>`.** `locking.is_gui_thread()` is
   `gui_ident is None or gui_ident == get_ident()` (`packages/engine/modules/pymol/locking.py`),
   and `pymol.glutThread` is module-level `None` which `SingletonPyMOL.start()` never sets. Without
   this line *every* thread is "the GUI thread" and the ordering guarantee is fiction.
6. **`cmd.set('movie_panel', 0)`**, on top of step 2: `OrthoReshape` also subtracts
   `MovieGetPanelHeight()` (`packages/engine/layer1/Ortho.cpp:2383-2390`), so the moment any object
   has more than one state the viewport silently loses ~15 px against the window.
7. **At least three warm-up draws.** `IDLE_AND_READY == 3` (`packages/engine/layer5/PyMOL.cpp:105`)
   and `IdleAndReady` only increments when `DrawnFlag` is set, which only happens inside
   `PyMOL_DrawWithoutLock`. Until it is reached, `OrthoExecDeferred` never runs and the first click
   is swallowed.

If PyMOL cannot be imported or no GL context can be created, the engine reports `degraded` or
`headless` rather than exiting; the front end has explicit handling for both, and
`TENMOL_BRIDGE_FORCE_NO_PYMOL=1` exercises the path on a machine that does have PyMOL.

## 3. The pump draws every tick

`Pump._run` drains the command FIFO, then calls `engine.tick()`, which is `p.idle()` followed by
`p.draw()`. **`draw()` is mandatory, not an optimisation.**

Mouse input into the scene is not executed on arrival — it is queued. `CScene::click`, `::drag` and
`::release` all go through `OrthoDefer` (`packages/engine/layer1/Scene.cpp:4113-4155`), and the
queue's only drain is `OrthoExecDeferred`, whose only caller in the whole tree is
`ExecutiveDrawNow`. `draw()` is also what clears `I->ModalDraw` (`packages/engine/layer5/PyMOL.cpp:2279-2286`),
which `cmd.mpng` sets and which otherwise makes every subsequent API call a no-op forever, and what
runs `SeqUpdate` for the sequence viewer (`packages/engine/layer1/Ortho.cpp:1470-1478,1882`).

A bridge that never draws returns success from every input call and does nothing.

## 4. Offscreen GL

`packages/bridge/tenmol_bridge/glcontext/` provisions a real hardware context with no window, one
FBO (colour + depth renderbuffers), on the thread that will own PyMOL.

| platform | backend | how |
| --- | --- | --- |
| macOS | `.../glcontext/cgl.py` | CGL legacy 2.1 profile, no drawable |
| Linux | `.../glcontext/egl.py` | EGL surfaceless (Mesa), then EGL device (NVIDIA headless), then `EGL_DEFAULT_DISPLAY` |
| Windows | `.../glcontext/wgl.py` | a `WS_POPUP` window that is never shown, for its DC only |

Two rules every backend honours, both stated in that package's `__init__.py`: contexts are per-thread
(calling `PyMOL_Draw` from a thread that does not hold the context segfaults at `glGetString`), and
resize re-storages the attachments of the **same** FBO name rather than regenerating it, because
PyMOL latched that name on its first draw.

A missing backend raises `NoOffscreenGL`; backends are imported lazily so the package imports
cleanly everywhere.

## 5. The wire

One WebSocket at `ws://127.0.0.1:8765/ws`, plus `GET /healthz` and `GET /blob/{id}` on the same
port. `packages/protocol` is the contract and has zero runtime dependencies; `packages/bridge`'s
`session.py` is its Python mirror, and the two are frozen together.

* **Text frames** carry JSON control and RPC. Client → server: `call | do | input | sub | unsub |
  ack`. Server → client: `hello | ok | err | event | feedback`.
* **Binary frames** carry bulk payloads — Mode G geometry and Mode P pixels:

  ```
  | uint32 LE header length | UTF-8 JSON metadata (space padded) | bytes |
  ```

  The header is padded so `4 + header_length` is a multiple of the alignment constant. That is what
  lets the TypeScript decoder hand back a zero-copy `Float32Array` view instead of copying every
  buffer, and it is easy to regress: object names `a`/`ab`/`abc` were measured putting the payload
  at byte 237/238/239.

Adding a message type is a `PROTOCOL_VERSION` bump plus a bridge change in the same commit. Adding
a *topic* is not — topics are the extension point, one module per topic under
`packages/protocol/src/topics/`, with a frozen barrel and registry.

## 6. The capability policy

Not a deny-list. `packages/bridge/tenmol_bridge/policy/` grants capabilities, and its module
docstring explains why: every symbol an earlier design proposed denying (`run`, `cd`, `system`,
`quit`, the `_ctrl`/`_alt` chord helpers, and raw command lines from the UI) is required by a
feature in the parity inventory. Every `pymol.menu` popup leaf and every wizard button returns a
*command string* (`packages/engine/layer4/PopUp.cpp:471-475`), so restricting raw command lines to
the console would have made the popup engine and the wizards unimplementable.

**The security boundary is the transport**: bind `127.0.0.1` only, a 256-bit token minted at
startup and written mode `0600`, an `Origin` allow-list, and a loopback peer check. What the policy
still does is shape-check dotted names (1–3 segments, no `__dunder__`), require a known namespace
root, require an explicit grant for any private *interior* segment, mark calls `dangerous`, and
route rather than execute a few of them (`quit` becomes a bridge shutdown, not the C `exit()`).

Work packages added grants as `policy/grants/wp-NN.py`; the loader merges them, so no shared file
ever had two writers.

## 7. Change detection

There is no event bus in the C core. Change detection is a **poll plus a command-echo channel**,
and the split matters:

* **The state tick** (`tenmol_bridge/state/`) snapshots names, enabled, groups, view, frame, state,
  scenes, vis, movie and wizard at 30 Hz (4 Hz when the tab is hidden) and diffs it into topic
  payloads. Measured on a 52,569-atom, 11-object scene: median
  67.7 µs per tick, 0.25 % of one core including the status thread, zero false positives over 300
  idle ticks. `cmd.count_atoms()` is banned from the tick — 5,902 µs for a selection at 500k atoms
  — so selection counts are a debounced client request instead.
* **Polling cannot see per-atom state.** `cmd.get_vis()` is object-level only: `show spheres, m and
  name CA` leaves it byte-identical while 574 atoms carry the rep, and per-atom colour is equally
  invisible. Those changes arrive on the invalidation channel instead — every executed command
  reports its invalidation classes with its result, from `tenmol_bridge/dispatch.py`.
* **Feedback, settings and progress** are genuine drains that clear as they are read, so the bridge
  is their **sole** consumer. A second reader silently steals updates.
* `_cmd.web_get_versions` reads four monotonic counters added to `CExecutive` — panel, enable, name
  and rep (see [section 10](#10-what-this-fork-changes-in-the-engine)). They are hints for the
  geometry cache, not content hashes.

## 8. The viewport: two render modes

|  | Mode P | Mode G |
| --- | --- | --- |
| who draws | PyMOL, into the offscreen FBO, with its own shaders | three.js, in the browser |
| what travels | encoded bitmaps | PyMOL's own CPU-side buffers |
| fidelity | 100 % by construction — volume, slice, labels, ray, every setting | the reps the accessor can express |
| default | yes | opt-in per rep, with automatic fallback |

**Mode P** (`tenmol_bridge/render/framestream.py`) reads the FBO back in a tick hook, after the
draw. Its dirty gate is a *pre-tick* probe of `PyMOL_GetRedisplay(reset=1)`, not a post-tick one,
because `PyMOL_Draw` clears `RedisplayFlag` at `packages/engine/layer5/PyMOL.cpp:2331` *before*
calling `ExecutiveDrawNow` — a hook that polls it after the draw sees `False` for every real
change and produces a viewport that never updates. Frames are JPEG while the camera moves and
lossless once it settles, and they are **dropped, never queued**: at most N un-acked frames per
client, with a timeout so a client that stops acking degrades to "no flow control" rather than to a
frozen viewport.

**Mode G** (`tenmol_bridge/render/modeg.py`) serves `_cmd.web_get_rep_geometry` — the C++ accessor
in `packages/engine/layer4/CmdWebGeometry.cpp` — reframed as indexed-mesh or CGO-draw-arrays binary
frames, keyed per object / rep / state. Two invariants it must not break: impostor reps (spheres,
nb_spheres, dots, ellipsoids) ship as instance buffers and never as triangles, and the draw-arrays
block is rebuilt verbatim in the layout of `packages/engine/layer1/CGO.cpp:1650-1671`, re-inserting
the pick slot the accessor skips, or every sub-array after it is silently shifted.

The two **composite**: Mode P blits into a 2-D canvas, Mode G draws into a transparent WebGL2
canvas stacked on top, both clipped to PyMOL's scene rectangle. `packages/viewport/README.md`
covers the client half; an e2e spec pins the bridge's draw counter at zero while dragging and
picking in pure Mode G.

## 9. Input and picking

Pointer, wheel and pinch events are forwarded 1:1 and in order as `{t:'input'}` frames and executed
by the engine on the next tick. The camera is *polled*, not predicted: `cmd.get_view()` costs about
2 µs backend-side and the client cannot compute it itself, because the mouse bindings that produce
it (the three `virtual_trackball` formulations, `mouse_scale`/`mouse_limit` clamping) live in the C
core. One request is in flight at a time, so during a drag the Mode-G camera tracks at loopback
round-trip rate.

**Picking is backend-authoritative whenever the backend can draw.** PyMOL picks by rendering a
colour-index pass and reading back one pixel (`packages/engine/layer1/ScenePicking.cpp`), which
works because the bridge has a real GL context — including rectangle selection via `SceneMultipick`
and the ButMode routing that sends a click to the editor in editing mode
(`packages/engine/layer1/SceneMouse.cpp:404-470`).

`packages/viewport/src/picking/` is the fallback for a backend that cannot draw: a client-side
raycast against the same geometry Mode G already holds. It is less accurate than PyMOL's own pass,
and `viewport.ts` skips it entirely while the server is rasterising. A pick — from either path —
is offered to registered routes most-recent-first, so an armed wizard or the Builder consumes it
before the default "rewrite `sele`" behaviour runs.

## 10. What this fork changes in the engine

`packages/engine/` is upstream PyMOL and is treated as read-only, with the exceptions below. Every
C++ edit is wrapped in `/* tenmol web client -- BEGIN */` … `/* -- END */` sentinels so it can be
found and re-applied by hand after an upstream merge.

| File | Change |
| --- | --- |
| `packages/engine/layer4/CmdWebGeometry.cpp` | **New file.** The Mode G geometry accessor. Auto-globbed by `setup.py`, so no build-file edit — and upstream has no such file, so it can never conflict. |
| `packages/engine/layer4/Cmd.cpp` | Method-table rows + forward declarations for the accessor. One contiguous insertion. |
| `packages/engine/layer3/ExecutiveDef.h`, `.../Executive.cpp` | Monotonic change counters on `CExecutive`, bumped where the executive invalidates. Hints for the geometry cache. |
| `packages/engine/pyproject.toml` | `readme = "PYMOL-README.md"`, because upstream's `README.md` was renamed to make room for this fork's. |

Nothing else under `packages/engine/` is edited, and `packages/engine/` is self-contained: its
`setup.py` uses paths relative to itself and builds without knowing this repo exists.

## 10b. Two backends behind one interface

The description above is the **remote** backend: drive the real C++/Python engine over the wire.
There is now a **second** backend — a TypeScript port of the engine that runs *in the browser* — and
the app chooses between them abstractly.

The seam is `@tenmol/backend`'s `Backend` interface (`packages/backend/src/backend.ts`): the exact
surface the app used from the socket client — `call`, `do`, `sub`/`unsub`, events, input, lifecycle.
Two implementations satisfy it:

| Backend | Package | Engine |
| --- | --- | --- |
| `RemoteBackend` | `@tenmol/client` (`createRemoteBackend`) | real PyMOL over `ws://…` (`PymolConnection`) |
| `LocalBackend` | `@tenmol/engine-ts` (`createLocalBackend`) | the TypeScript port, in-process |

`createCmd()` needs only `call`+`do`, so the whole `cmd` façade — and `@tenmol/stores`,
`@tenmol/viewport` and every feature — is backend-agnostic. `apps/web/src/app/session.ts` is the one
place that constructs a backend, from `config.backend` (`apps/web/src/app/config.ts`
`resolveBackendKind`): the **subdomain** the page is served on picks the engine (a `ts.`/`engine.`
host → local, a `pymol.`/`bridge.` host → remote), overridable with `?backend=` or
`VITE_TENMOL_BACKEND` for dev/CI/the parity harness.

The TypeScript engine emits the identical `@tenmol/protocol` topic payloads and Mode-G binary frames,
so the existing three.js renderer draws its geometry unchanged (the viewport defaults to Mode G for
the local backend, since it has no offscreen GL to rasterise Mode P). Its 1-to-1 parity with real
PyMOL over the ported command slice is proven by the differential suite in `tools/parity` — see
`docs/engine-port.md`.

## 11. The client

```
apps/web/            the React app: shell, layout, and one directory per feature
packages/protocol/   wire types, topic modules, binary-frame codec — no runtime deps
packages/client/     the socket client: connection, events, typed cmd
packages/stores/     client state — ~700 lines of plain TS, no state library
packages/viewport/   the canvas, both render modes, input forwarding — framework-free
```

The shell mounts features by id from `apps/web/src/features/registry.ts`, so a feature directory is
self-contained and the shell never imports one directly. `packages/viewport` imports no React;
`apps/web/src/features/viewport` is its binding.

PyMOL draws its own "internal GUI" — object panel, movie panel, mouse-mode block, wizard panel and
prompt, scene buttons, command prompt, feedback scrollback, busy box, splash, selection marquee —
as 2-D blocks *inside* the GL viewport, stacked by `OrthoLayoutPanel()`
(`packages/engine/layer1/Ortho.cpp:2261-2340`). In this client all of them are DOM. That is the
largest structural difference from the original, and it is why `internal_gui_width`,
`internal_gui_control_size` and `internal_gui_mode` are honoured as CSS hints for `.pse`
round-trip parity rather than as layout drivers.

Each package README documents its own internals: `packages/bridge/README.md`,
`packages/protocol/README.md`, `packages/stores/README.md`, `packages/viewport/README.md`,
`apps/web/README.md`, `apps/web/e2e/README.md`.

## 12. Limits

Things that are permanently Mode P, because they have no Mode G expression. The authoritative list
is `MODE_G_CAPABLE_REPS` in `packages/protocol/src/geometry.ts`; everything not in it falls back
with a stated reason, because a silently empty screen is exactly what the exporters produce.

| Surface | Why |
| --- | --- |
| `cmd.ray` output | A CPU ray tracer with `ray_trace_mode` cel shading, outlines, true shadows and interior colours that have no GL path at all. Interactive is the viewport; publication is a server bitmap. |
| `labels` | Text needs a DOM or atlas overlay, not geometry. Every exporter emits 0 bytes. |
| `volume` | A 3-D scalar field, served through `get_volume_field` as a blob instead. |
| `cRepCallback` | Arbitrary user Python that draws with raw GL, and needs a real context even to construct. |

Accepted differences from the Qt front-end:

* **Quality dips during motion.** Mode P sends JPEG while the camera moves; thin lines, labels and
  ray-trace outlines are momentarily softened during a drag.
* **`cmd.viewport w,h` cannot resize the window.** A browser cannot resize itself; it resizes the
  canvas and reports the achieved size back, which is observably different for scripts.
* **Single-click latency has a ~150 ms floor**, imposed by `I->SingleClickDelay`
  (`packages/engine/layer1/SceneMouse.cpp:1152`). Not fixable client-side.
* **Some keyboard chords are the browser's.** PyMOL binds `CTRL-T`, `CTRL-F`, `CTRL-N`, `CTRL-W`;
  several cannot be `preventDefault`-ed in a normal tab.
* **Two stereo modes cannot cross the wire.** A mode arrives if both eyes fit in one 2-D image:
  anaglyph, cross-eye, wall-eye and Zalman by-row all do, and all work in Mode P. `quadbuffer`
  wants a second GL colour buffer and `openvr` wants a head-mounted display; the frame transport is
  one read off a single FBO encoded as one image, so neither can ever arrive. Neither is available
  in Mode G at all — see `apps/web/src/features/menubar/stereo.ts`, which measured every leaf.
* **The Tk skin is gone.** This client replaces `pmg_qt` only. Legacy Tk plugins cannot be ported:
  `mimic_pmg_tk.PMGApp` creates a real hidden `tkinter.Tk()` root and `mimic_tk.py` installs a
  global `sys.meta_path` hook that still fires headlessly and hands plugins invisible dialogs.
* **Features that are incentive-only in open-source PyMOL stay broken**, but loudly. `cmd.clean`,
  `cmd.load_mtz`, `.mae` load, `.mtl`/STL export, `assign_stereo`, `morph`, `focal_blur`,
  `find_pi_interactions` and others raise `IncentiveOnlyException` here;
  `tenmol_bridge/incentive_only.py` is the manifest, and affected UI surfaces surface the error
  rather than silently no-op.
* **Undo is at open-source parity.** `editor.undocontext` is a no-op stub upstream, so most
  "undoable" Builder actions are not undoable.
* **Generated API types are largely heuristic.** Only a handful of type annotations exist across
  the ~400 API symbols; the override table plus a CI drift check are the mitigation.

## 13. `plan §…` in source comments

Many source files cite `plan §N` or a critique code. Those documents are gone; this is where the
decisions they named now live.

| Citation | Now |
| --- | --- |
| plan §1.1 (the pump) | [§2 Boot order](#2-boot-order-and-why-it-is-not-negotiable), [§3 The pump draws every tick](#3-the-pump-draws-every-tick) |
| plan §1.2 (feedback capture) | [§1 Process and threads](#1-process-and-threads) — the status thread and the sole-consumer rule |
| plan §1.3 (the render feed) | [§8 The viewport: two render modes](#8-the-viewport-two-render-modes) |
| plan §1.4 (picking) | [§9 Input and picking](#9-input-and-picking) |
| plan §1.5 (change detection) | [§7 Change detection](#7-change-detection) |
| plan §A6, critique A6 (the deny-list) | [§6 The capability policy](#6-the-capability-policy) |
| plan §B7, critique B7 (broken upstream) | [§12 Limits](#12-limits) and `tenmol_bridge/incentive_only.py` |
| plan §B8 (non-JSON returns) | `packages/protocol/src/codec.ts` and `tenmol_bridge/codec.py` — the typed codec table and the copy-before-unlock rule |
| plan §4 (C++ work) | [§10 What this fork changes in the engine](#10-what-this-fork-changes-in-the-engine) |
| plan §5.1/§5.2, critique A8 (file collisions) | `docs/code-ownership.md`, which is now only the file-ownership map |
| plan §6 (work packages) | `docs/code-ownership.md` |
| plan §7 (not achievable) | [§12 Limits](#12-limits) |
| critique A1–A5, A7, A9 | Resolved in the code; the mechanics are in [§2](#2-boot-order-and-why-it-is-not-negotiable) and [§3](#3-the-pump-draws-every-tick) |

The `spikes/` directory holds the measured experiments those decisions came from, and the citations
into it are still live.
