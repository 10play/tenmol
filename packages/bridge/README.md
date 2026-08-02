# tenmol-bridge

The PyMOL side of the tenmol web client. One process, one PyMOL engine, one
thread that owns the offscreen OpenGL context **and** the engine **and** the draw
pump, one local browser, one WebSocket.

```
browser ──ws://127.0.0.1:8765/ws──▶ uvicorn / asyncio thread   (touches PyMOL: never)
                                        │ FIFO + futures
                                        ▼
                                ENGINE THREAD            60 Hz
                                  GL context + FBO
                                  pymol2.SingletonPyMOL
                                  drain FIFO
                                  p.idle()
                                  p.draw()   ◀── MANDATORY, see below
                                  tick hooks (Mode P, Mode G, state tick)
                                        ▲
                                STATUS THREAD            10 Hz
                                  cmd.get_progress()
                                  cmd._get_feedback()
                                  cmd.get_setting_updates()
                                  (the only lock-ATTEMPTING calls in the API)
                                  + the client-liveness watchdog
```

Every non-obvious line in this package carries a `file:line` citation into
`packages/engine/layer*/` or `packages/engine/modules/`. Follow the citation
before changing the line.

## Run it

```bash
# from the repo root; needs a venv with PyMOL built from this tree
bash scripts/dev-bridge.sh                          # ws://127.0.0.1:8765/ws
bash scripts/dev-bridge.sh --port 9000 --width 1280 --height 960
TENMOL_VENV=/path/to/venv bash scripts/dev-bridge.sh
packages/bridge/.venv/bin/python -m tenmol_bridge --help
```

`bash scripts/bootstrap.sh` builds the venv and PyMOL from this tree if you do
not have one. `pnpm dev` starts this and the web client together.

`GET /healthz` reports the whole process model. Measured on a real start:

```json
{"state":"running","pymolVersion":"3.2.0a",
 "threadIdent":6158807040,"glutThread":6158807040,
 "ticks":703,"draws":708,"lastTickMs":0.067,"bootSeconds":0.117,
 "width":1280,"height":960,"tickHz":60.0,"tickOverruns":0,"queueDepth":0,
 "gl":{"backend":"cgl","vendor":"Apple","renderer":"Apple M4 Max",
       "version":"2.1 Metal - 89.4","glsl":"1.20","fbo":1,
       "colorBits":[8,8,8,8],"depthBits":32,"available":true},
 "status":{"running":true,"hz":10.0,"polls":114,"lockMisses":2,"maxPollMs":0.084},
 "clients":0,"sessions":[],"blobs":{...},"shims":{"installed":true,...},
 "liveness":{"clients":0,"clientsEver":0,"idleShutdownSeconds":0.0,"armed":false},
 "push":{"settingsPushes":0,"settingsPending":0,...}}
```

`glutThread == threadIdent` is not decoration — see rule 1.

## Layout

```
tenmol_bridge/
  __main__.py     the CLI, and ShutdownWatcher (turns shutdown_requested into
                  uvicorn's should_exit — without it File > Quit did nothing)
  server.py       FastAPI app: GET /healthz, GET /blob/{id}, WS /ws. Owns the
                  sessions, the topic broadcast and the liveness watchdog
  pump.py         the 60 Hz engine thread, on absolute deadlines
  engine.py       PyMOL startup, the warm-up draws, the option snapshot
  dispatch.py     wire `fn` -> a callable on the engine thread; `call`, `do`,
                  `input`. Attaches invalidation classes to every result
  policy/         capability policy: base.py + grants/*.py (never edit base.py)
  panels/         14 internal-GUI data feeds (objects, movie, seqview, menus,
                  settings, files, colors, volume, properties, plugins,
                  builder, compute, shortcuts, wizards)
  render/         Mode P (framestream + encode) and Mode G (modeg.py)
  state/          the 30 Hz / 4 Hz polled snapshot + diff
  glcontext/      cgl.py | egl.py | wgl.py, dispatched by sys.platform
  session.py      the Python mirror of @tenmol/protocol. Frame builders, the
                  binary codec, ClientSession
  codec.py        result -> wire value (ndarray, blobs, chempy)
  blobs.py        big results served over GET /blob/{id}
  subproc.py      external processes (APBS), with a kill watchdog
  shims.py        the GL-context and Qt-replacement shims (see (a) below)
```

`topics.py` is a wave-0 leftover with a 7-topic set and **nothing imports it**.
`session.py` is the live mirror; use that.

## The four rules

### 1. The pump calls `PyMOL_Draw` every tick. `cmd.refresh()` is not a substitute.

Viewport input is not executed on arrival, it is _enqueued_: `CScene::click`,
`drag` and `release` all go through `OrthoDefer`
(`packages/engine/layer1/Scene.cpp:4113-4155`), as do deferred `cmd.png` and
deferred `cmd.ray`. The queue is drained by `OrthoExecDeferred`
(`packages/engine/layer1/Ortho.cpp:268-277`), whose only caller is
`ExecutiveDrawNow` (`packages/engine/layer3/Executive.cpp:11521-11523`) — and
that call is gated on `PyMOL_GetIdleAndReady`, i.e. `IdleAndReady == 3`
(`packages/engine/layer5/PyMOL.cpp:105`, `:2560-2562`). `IdleAndReady` only
increments inside `PyMOL_Idle` while `I->DrawnFlag` is set (`:2412-2416`), and
`DrawnFlag` is only ever set inside `PyMOL_Draw` (`:2325`, `:2328`). `CmdRefresh`
never sets it.

A bridge that does not draw therefore drains **no** clicks, **no** drags, no
deferred `png`, no deferred `ray`, no `ModalDraw` — silently, with no error and
no log line. `engine.py` does ≥ 3 warm-up draws before accepting input for the
same reason. This is also why `--no-gl` needs the client's RPC camera driver:
raw `{t:'input'}` is accepted and never applied (measured: a 20-step drag moved
`get_view()[2]` by exactly 0).

Tick rate: 60 Hz, on **absolute** deadlines. Measured here,
`queue.get(timeout=1/60)`, `time.sleep(1/60)` and `Event.wait(1/60)` all return
after ~22 ms (macOS timer coalescing), so a relative loop tops out near 45 Hz. It
must in any case stay well under 150 ms, because `SceneIdle` only promotes
press+release into a single click after `I->SingleClickDelay = 0.15`
(`packages/engine/layer1/SceneMouse.cpp:1152`).

### 2. `no_gui = 0`, `SingletonPyMOL`, `pcatch` — and never `-c`.

`OrthoFeedbackIn()` is gated on `G->Option->pmgui`
(`packages/engine/layer1/Ortho.cpp:492-499`), which is `!options.no_gui`
(`packages/engine/layer1/P.cpp:1820`). `pymol -c` sets `no_gui=1`
(`packages/engine/modules/pymol/invocation.py:401`) and the feedback queue is
then dead for the life of the process. Options are snapshotted into
`CPyMOLOptions` at `_cmd._new`, so they must be set **before** `start()`.

`pcatch` writes through the file-scope `SingletonPyMOLGlobals` pointer
(`packages/engine/layer1/P.cpp:2667`): with a non-singleton `pymol2.PyMOL()` that
pointer is null and every `print()` is silently discarded — worse than not
installing it. Hence `pymol2.SingletonPyMOL`, exactly like `pmg_qt`.

### 3. The bridge logs to **stderr only**.

After `pcatch._install()`, the `pcatch` module _is_ `sys.stdout` **and**
`sys.stderr`. Any `print()` in this process lands in the user's PyMOL console.
Use `tenmol_bridge.config.log`, which writes to the real stderr captured at
import time. `tests/test_process_model.py` asserts no bridge log line ever
reaches `cmd._get_feedback()`.

### 4. Exactly one consumer of each destructive drain.

`cmd._get_feedback()`, `cmd.get_setting_updates()` and
`p.getRedisplay(reset=True)` are consume-once. Two interleaved consumers split
the stream at random (measured: `consumerA saw: [468 lines]`, `consumerB saw:
[]`). The status thread owns all three; the policy refuses to expose them over
the wire, and nothing else in this process may call them. No `pymol.rpc`, no
`pymol.pymolhttpd`, no Qt GUI, no plugin.

`_get_feedback()` returning `None` means **"locked, retry"**, not "no output"
(`packages/engine/modules/pymol/internal.py:596-606`). `get_setting_updates()`
returning `[]` on a lock miss is indistinguishable from "nothing changed"
(`packages/engine/modules/pymol/setting.py:440-447`) — never build quiescence
detection on it. `panels/settings.py` is the pattern: it taps the drain once and
publishes a cumulative, cursor-addressed log, so clients can poll slowly and
losslessly instead of racing the status thread.

## Two things the plan got wrong; both are implemented the corrected way here

**(a) `_call_with_opengl_context` must NOT be left at its default.** The plan says
the default `lambda f: f()` is already correct once every `cmd` call runs on the
GL-owning thread. It is not. `G->ValidContext` is a counter incremented only
inside `PyMOL_Draw` (`PyMOL_PushValidContext`,
`packages/engine/layer5/PyMOL.cpp:2940-2949`, called at `:2281`/`:2303`); holding
the context current does not set it, because it is PyMOL's own flag, not GL
state. So every path gated on `G->HaveGUI && G->ValidContext` silently does
nothing when reached from a plain `cmd` call. Measured: `cmd.png()` with no
explicit size wrote **no file**, and `cmd.mpng(prefix)` printed
`MoviePNG-Error: Missing rendered image.` five times and produced **zero** PNGs.
`shims.py` installs `marshal-to-engine-thread + _pushValidContext + func() +
_popValidContext` (both are registered C entry points,
`packages/engine/layer4/Cmd.cpp:6379-6380`); with it the same two calls produce a
20,428-byte PNG and `['f0001.png','f0002.png','f0003.png']`. This is not the
`pmg_qt` shim — the `makeCurrent()` half of that is Qt-specific and is not
copied.

**(b) `cmd.get_view()` returns 18 floats, not 25.**
`packages/engine/modules/pymol/viewing.py:731` slices the C accessor's 25 down to
`r[0:3]+r[4:7]+r[8:11]+r[16:25]`. `_cmd.get_view()` is the 25-float one. `[:9]`
is the rotation matrix in both.

Also worth knowing: **`import pymol` must happen before anything imports
`chempy`**. `pymol/__init__.py:202-210` sets `PYMOL_PATH`/`PYMOL_DATA`, and
`chempy/__init__.py:267-274` reads them _at import time_; get the order wrong and
`chempy.path` is `''` forever and `cmd.fragment('ala')` fails with
`FileNotFoundError: 'fragments/ala.pkl'`. `tests/conftest.py` pins the order for
the whole test session.

## Protocol v1

`tenmol_bridge/session.py` is the Python mirror of `packages/protocol`; the
strings must match exactly.

| dir | frame                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------- |
| C→S | `{id, t:'call', fn, args, kwargs}`                                                                                    |
| C→S | `{id, t:'do', cmd, echo?}`                                                                                            |
| C→S | `{id?, t:'input', kind:'button'\|'drag'\|'reshape'\|'key'\|'scroll', ...}`                                            |
| C→S | `{id, t:'sub'\|'unsub', topic}`                                                                                       |
| C→S | `{id, t:'confirm', fn}` — the one-time `cmd.system` confirmation                                                      |
| C→S | `{id, t:'ping'}`                                                                                                      |
| S→C | `{t:'hello', protocolVersion, pymolVersion, state, width, height, glutThread, threadIdent, gl, incentiveOnly, modeG}` |
| S→C | `{id, t:'ok', result, invalidates?, dangerous?}`                                                                      |
| S→C | `{id, t:'err', error:{kind, type, message, detail?, traceback}}`                                                      |
| S→C | `{t:'event', topic, seq, payload}`                                                                                    |
| S→C | `{t:'feedback', lines:[...]}`                                                                                         |
| S→C | binary: `uint32 LE header length \| UTF-8 JSON meta (space-padded) \| bytes`                                          |

The binary header is padded so the payload starts 4-byte aligned; that is what
lets the TypeScript decoder return a zero-copy `Float32Array` view instead of
memcpy-ing every buffer. Do not regress it.

19 topics, one owner each: `feedback` `progress` `redisplay` `pixels` `view`
`selection` `objects` `menu` `settings` `wizard` `editor` `dialog` `frame`
`scenes` `movie_panel` `seqview` `colors` `plugin` `geometry`.

Error kinds: `CmdException` `QuietException` `IncentiveOnly` `NotAllowed`
`NotSerializable` `PythonError` `PyMOLUnavailable` `NoOffscreenGL` `BadMessage`
`Timeout` `EngineNotRunning` `Shutdown`. (`@tenmol/protocol` types the first six;
the rest are bridge-only and arrive as opaque strings on the client.)

### The command-echo invalidation channel

Every executed command reports what it invalidated (`color` / `reps` /
`geometry` / `coords` / `names`, or `resync` for `do`/`run`/`@script`) in the
`ok` frame. This is the **only** mechanism that can see per-atom colour and
per-atom reps: polling provably cannot. `cmd.get_vis()` is object-level only —
`show spheres, m and name CA` leaves it byte-identical while 574 atoms carry the
new rep.

### Unicast vs broadcast

`_emit_topic` is a broadcast and stays one: `objects`, `view`, `frame`,
`feedback`, `progress` and the Mode-G _invalidation_ notice are shared state.
What must not go through it is one client's answer — `_bridge.get_geometry` and
`_bridge.pull_geometry` are `UNICAST_ROUTES`, because broadcasting them makes N
clients each pay for one client's 360 KB pull. That is why the calling session is
threaded all the way down through `dispatch.py`.

## Security

The boundary is the **transport**, not a symbol deny-list:

- bind `127.0.0.1` only (`--allow-remote` is refused by default);
- a 256-bit token minted at startup, written mode `0600` with `--token-file`,
  required on `/ws` and `/blob/{id}`;
- an `Origin` allow-list (a fixed port range — an ephemeral dev port needs
  `--origin`, which is what the e2e harness passes);
- a loopback peer check. The precedent is PyMOL's own HTTP bridge, which hard
  rejects non-loopback peers
  (`packages/engine/modules/pymol/pymolhttpd.py:61-68`).

A rejected token closes with `4401`, a rejected origin or peer with `4403`.

`system`, `run`, `cd`, `quit`, `_ctrl`/`_alt`/`_ctsh` and `t:'do'` are all
**allowed**. Denying them removed six features from the parity inventory and
bought nothing: this product executes arbitrary local code by design — it is a
desktop replacement for a program with a Python console. What the policy does
instead is check _shape_ (1..3 identifier segments, no dunders), check
_namespace_ against `DEFAULT_ROOTS`, merge per-owner _grants_, take one
confirmation for `cmd.system`, route `cmd.quit` to bridge shutdown instead of the
C `exit()` path (which skips `atexit` and `Py_FinalizeEx`), and mark every
dangerous call so the UI and the log can show it.

`quiet` is **passed through, never forced to 1**: several parity rows depend on
`quiet=0` output reaching the console.

### Adding a capability

Do **not** edit `policy/base.py`. Drop a file:

```python
# packages/bridge/tenmol_bridge/policy/grants/wp-13.py
from tenmol_bridge.policy.base import Grant

GRANT = Grant(
    wp="WP-13",
    note="pymol.menu.* resolution for the popup engine",
    roots={"menu"},
    invalidates={"mol_show": ("reps",)},
)
```

The loader merges every `grants/*.py` in sorted order (by path, with
`importlib.util`, because a filename with a hyphen is not an importable module
name). A grant file may export `GRANT`, `GRANTS` or a callable `grants()`.

## The barrels are frozen; the modules next to them are not

`panels/__init__.py` and `state/__init__.py` were written once and list a small,
fixed set of names with lazy PEP-562 access. **They have drifted from reality on
purpose**: `panels/PANELS` names four modules while `panels/` contains fourteen.
That is the design, not a bug — a feature adds `panels/<mine>.py` and imports it
directly (`from .panels.settings import values`), which is an import rather than
an edit, so two owners never collide on one file. Do not "fix" the barrel to
match the directory.

Most panels install themselves onto `cmd` as a `cmd.tenmol_*` namespace
(`tenmol_files`, `tenmol_compute`, `tenmol_props`, `tenmol_plugins`,
`tenmol_volume`, `tenmol_shortcuts`) so the browser reaches them through ordinary
`{t:'call'}` frames and no new endpoint is needed.

## It runs without PyMOL, and without GL, on purpose

`--no-pymol` (or `TENMOL_BRIDGE_FORCE_NO_PYMOL=1`), or simply a machine where
`import pymol` fails: the engine goes to state `degraded`, the server still
starts, `hello` reports `"state":"degraded"`, `sub`/`unsub` still work, and every
engine-bound call answers with

```json
{
  "id": 1,
  "t": "err",
  "error": {
    "kind": "PyMOLUnavailable",
    "type": "PyMOLUnavailable",
    "message": "PyMOL is not available in this bridge process: ImportError: ..."
  }
}
```

so the front end stays developable.

`--no-gl` is the other half and it is the cross-platform thesis made runnable: it
refuses to create a context at all, exactly like a Linux box with no EGL or a
Windows box with no WGL. The console, the RPC surface, `cmd.ray` and Mode-G
geometry extraction all still work; Mode P and backend picking do not, and the
client is expected to render and pick client-side. `apps/web/e2e` has one spec
that asserts precisely that, ending with `healthz.draws == 0`.

## Offscreen GL

`glcontext/` is dispatched on `sys.platform`: `cgl.py` (darwin, CGL legacy 2.1,
no drawable, one FBO), `egl.py` (linux), `wgl.py` (win32). The interface is
`create_context(width, height) -> Context` with `.make_current()`,
`.resize(w, h)`, `.release()` and `.info() -> dict`. A missing backend raises the
typed `NoOffscreenGL`.

Two rules any backend must honour:

1. **Contexts are per-thread.** Create it on the engine thread. Calling
   `PyMOL_Draw` from a thread that does not hold the context segfaults at
   `glGetString` (`packages/engine/layer5/PyMOL.cpp:2307`).
2. **Never regenerate the FBO on resize.** `check_gl_stereo_capable` latches
   `G->ShaderMgr->defaultBackbuffer.framebuffer` from `GL_FRAMEBUFFER_BINDING` at
   the first draw (`packages/engine/layer5/PyMOL.cpp:2236-2239`). `resize()`
   re-storages the attachments of the same FBO name.

macOS caveats: hardware CGL contexts need a WindowServer connection, so a
`launchd` _daemon_ (as opposed to a per-user agent) may fail; and one benign
driver line — `UNSUPPORTED (log once): POSSIBLE ISSUE: unit 0
GLD_TEXTURE_INDEX_2D is unloadable...` — appears on every start.

## Idle shutdown

A Qt PyMOL quits from `closeEvent -> cmd.quit()`; a browser tab has no
equivalent — it can be closed, crash, or have its machine suspended, and in none
of those cases does anything call `cmd.quit`. The status thread therefore watches
`len(sessions)` and calls `request_shutdown` after `--idle-shutdown SECONDS`.

**It defaults to 0 (never), deliberately.** `pnpm dev` reloads the page
constantly and the test suite shares one engine across long client-free
stretches; an armed watchdog would kill both. It also only arms after a client
has connected at least once. `TENMOL_BRIDGE_IDLE_SHUTDOWN` sets the default;
`--idle-shutdown` overrides it. `/healthz.liveness` shows the whole state.

## Tests

```bash
$ packages/bridge/.venv/bin/python -m pytest packages/bridge/tests -q
1851 passed, 1 skipped, 902 warnings in 524.26s (0:08:44)
```

Run it from the repo root: PyMOL resolves `packages/engine/test/dat/...`
relative to the cwd. `pnpm test:bridge` does the same thing through
`scripts/dev-bridge.sh --exec`.

`-s` (capture off) is **mandatory** and is in `addopts`: pytest's output capture
re-assigns `sys.stdout` around every test phase, which silently un-installs
`pcatch` and makes the Python half of the console vanish. `conftest.py` refuses
to run without it.

`pymol2.SingletonPyMOL` can only start once per process, so all engine tests
share one session-scoped bridge — a real uvicorn server on a real loopback port,
driven over a real WebSocket. That means **test order matters and session state
carries**: assert on the object you created, not on `all`. GL-dependent tests are
marked `gl` and skip themselves when no context can be created.

`test_process_model.py` is the acceptance suite for the process model: it drags
the mouse and asserts `get_view()[:9]` changed, asserts the feedback drain
carries both `PyMOL>print(...)` and the printed value, runs `cmd.mpng` and
asserts the engine still answers, asserts `glutThread == threadIdent`, and
asserts no bridge log line leaks into the console.

`test_p11_infra2.py` runs the real PEP 517 build hook and reads the wheel and
sdist back with `zipfile`/`tarfile`. It exists because `setuptools` ships `*.py`
and nothing else unless told: before `[tool.setuptools.package-data]`, a built
wheel held 43 `.py` files and zero `.json`, and an installed bridge reported
`defaultsSource: null` with 0 of 779 settings carrying a default. Monkeypatching
a path inside the source tree cannot see that failure.
