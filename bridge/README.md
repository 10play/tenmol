# tenmol-bridge

The PyMOL side of the tenmol web client. One process, one PyMOL engine, one
thread that owns a real offscreen OpenGL context **and** the engine **and** the
draw pump, one local browser, one WebSocket.

```
browser ──ws://127.0.0.1:8765/ws──▶ uvicorn / asyncio thread   (touches PyMOL: never)
                                        │ FIFO + futures
                                        ▼
                                ENGINE THREAD            60 Hz
                                  CGL context + FBO
                                  pymol2.SingletonPyMOL
                                  drain FIFO
                                  p.idle()
                                  p.draw()   ◀── MANDATORY, see below
                                  tick hooks (Mode P, state tick)
                                        ▲
                                STATUS THREAD            10 Hz
                                  cmd.get_progress()
                                  cmd._get_feedback()
                                  cmd.get_setting_updates()
                                  (the only lock-ATTEMPTING calls in the API)
```

Implements `docs/webclient/03-implementation-plan.md` §1.1 (the pump), §1.2
(feedback), §A6 (capability policy), §B7 (Incentive-only manifest) and §B8 (the
codec). Read that document before changing anything here; every non-obvious line
in this package has a file:line citation into `layer*/` or `modules/` next to it.

---

## Run it

```bash
# from the repo root; needs a venv with PyMOL built from this tree
# (docs/webclient/spikes/00-build.md)
TENMOL_VENV=/path/to/venv scripts/dev-bridge.sh
scripts/dev-bridge.sh --port 9000 --width 1280 --height 960
python -m tenmol_bridge --help
```

`GET /healthz` reports the whole process model:

```json
{"state":"running","pymolVersion":"3.2.0a",
 "threadIdent":6152744960,"glutThread":6152744960,
 "ticks":912,"draws":917,"lastTickMs":0.02,"width":1280,"height":960,
 "gl":{"backend":"cgl","renderer":"Apple M4 Max","version":"2.1 Metal - 89.4",
       "fbo":1,"colorBits":[8,8,8,8],"depthBits":32},
 "queueDepth":0,"tickOverruns":0,
 "status":{"running":true,"hz":10.0,"polls":189,"lockMisses":14,"maxPollMs":0.038}}
```

`glutThread == threadIdent` is not decoration — see "the four rules" below.

---

## The four rules

### 1. The pump calls `PyMOL_Draw` every tick. `cmd.refresh()` is not a substitute.

Viewport input is not executed on arrival, it is *enqueued*: `CScene::click`,
`drag` and `release` all go through `OrthoDefer` (`layer1/Scene.cpp:4113-4155`),
as do deferred `cmd.png` and deferred `cmd.ray`. The queue is drained by
`OrthoExecDeferred` (`layer1/Ortho.cpp:268-277`), whose only caller is
`ExecutiveDrawNow` (`layer3/Executive.cpp:11521-11523`) — and that call is gated
on `PyMOL_GetIdleAndReady`, i.e. `IdleAndReady == 3` (`layer5/PyMOL.cpp:105`,
`:2560-2562`). `IdleAndReady` only increments inside `PyMOL_Idle` while
`I->DrawnFlag` is set (`:2412-2416`), and `DrawnFlag` is only ever set inside
`PyMOL_Draw` (`:2325`, `:2328`). `CmdRefresh` never sets it.

A bridge that does not draw therefore drains **no** clicks, **no** drags, no
deferred `png`, no deferred `ray`, no `ModalDraw` — silently, with no error and
no log line. `engine.py` does ≥ 3 warm-up draws before accepting input for the
same reason.

Tick rate: 60 Hz, on **absolute** deadlines. Measured here, `queue.get(timeout=1/60)`,
`time.sleep(1/60)` and `Event.wait(1/60)` all return after ~22 ms (macOS timer
coalescing), so a relative loop tops out near 45 Hz. It must in any case stay
well under 150 ms, because `SceneIdle` only promotes press+release into a single
click after `I->SingleClickDelay = 0.15` (`layer1/SceneMouse.cpp:1152`).

### 2. `no_gui = 0`, `SingletonPyMOL`, `pcatch` — and never `-c`.

`OrthoFeedbackIn()` is gated on `G->Option->pmgui` (`layer1/Ortho.cpp:492-499`),
which is `!options.no_gui` (`layer1/P.cpp:1820`). `pymol -c` sets `no_gui=1`
(`modules/pymol/invocation.py:401`) and the feedback queue is then dead for the
life of the process. Options are snapshotted into `CPyMOLOptions` at `_cmd._new`,
so they must be set **before** `start()`.

`pcatch` writes through the file-scope `SingletonPyMOLGlobals` pointer
(`layer1/P.cpp:2667`): with a non-singleton `pymol2.PyMOL()` that pointer is
null and every `print()` is silently discarded — worse than not installing it.
Hence `pymol2.SingletonPyMOL`, exactly like `pmg_qt`.

### 3. The bridge logs to **stderr only**.

After `pcatch._install()`, the `pcatch` module *is* `sys.stdout` **and**
`sys.stderr`. Any `print()` in this process lands in the user's PyMOL console.
Use `tenmol_bridge.config.log`, which writes to the real stderr captured at
import time. `bridge/tests/test_process_model.py` asserts no bridge log line
ever reaches `cmd._get_feedback()`.

### 4. Exactly one consumer of each destructive drain.

`cmd._get_feedback()`, `cmd.get_setting_updates()` and `p.getRedisplay(reset=True)`
are consume-once. Two interleaved consumers split the stream at random
(measured: `consumerA saw: [468 lines]`, `consumerB saw: []`). The status thread
owns all three; the policy refuses to expose them over the wire, and nothing
else in this process may call them. No `pymol.rpc`, no `pymol.pymolhttpd`, no Qt
GUI, no plugin.

`_get_feedback()` returning `None` means **"locked, retry"**, not "no output"
(`modules/pymol/internal.py:596-606`). `get_setting_updates()` returning `[]` on
a lock miss is indistinguishable from "nothing changed"
(`modules/pymol/setting.py:440-447`) — never build quiescence detection on it.

---

## Two things this package discovered that the plan gets wrong

Both are implemented here and both need a plan amendment.

**(a) `_call_with_opengl_context` must NOT be left at its default.** Plan §A4
says the default `lambda f: f()` is already correct once every `cmd` call runs on
the GL-owning thread. It is not. `G->ValidContext` is a counter incremented only
inside `PyMOL_Draw` (`PyMOL_PushValidContext`, `layer5/PyMOL.cpp:2940-2949`,
called at `:2281`/`:2303`); holding the CGL context current does not set it,
because it is PyMOL's own flag, not GL state. So every path gated on
`G->HaveGUI && G->ValidContext` silently does nothing when reached from a plain
`cmd` call. Measured: `cmd.png()` with no explicit size wrote **no file**, and
`cmd.mpng(prefix)` printed `MoviePNG-Error: Missing rendered image.` five times
and produced **zero** PNGs. `shims.py` installs
`marshal-to-engine-thread + _pushValidContext + func() + _popValidContext`
(`_pushValidContext`/`_popValidContext` are registered C entry points,
`layer4/Cmd.cpp:6379-6380`); with it, the same two calls produce a 20,428-byte
PNG and `['f0001.png','f0002.png','f0003.png']`. This is not the `pmg_qt` shim —
the `makeCurrent()` half of that is Qt-specific and is not copied.

**(b) `cmd.get_view()` returns 18 floats, not 25.** Plan §6 (WP-09) has it the
other way round. `modules/pymol/viewing.py:731` slices the C accessor's 25 down
to `r[0:3]+r[4:7]+r[8:11]+r[16:25]`. `_cmd.get_view()` is the 25-float one.
`[:9]` is the rotation matrix in both.

Also worth knowing: **`import pymol` must happen before anything imports
`chempy`**. `pymol/__init__.py:202-210` sets `PYMOL_PATH`/`PYMOL_DATA`, and
`chempy/__init__.py:267-274` reads them *at import time*; get the order wrong and
`chempy.path` is `''` forever and `cmd.fragment('ala')` fails with
`FileNotFoundError: 'fragments/ala.pkl'`.

---

## Protocol v1

Frozen. `tenmol_bridge/session.py` is the Python mirror of
`packages/protocol` (WP-01); the strings must match exactly.

| dir | frame |
|---|---|
| C→S | `{id, t:'call', fn, args, kwargs}` |
| C→S | `{id, t:'do', cmd, echo?}` |
| C→S | `{id?, t:'input', kind:'button'\|'drag'\|'reshape', ...}` |
| C→S | `{id, t:'sub'\|'unsub', topic}` |
| C→S | `{id, t:'confirm', fn}` — the one-time `cmd.system` confirmation |
| C→S | `{id, t:'ping'}` |
| S→C | `{t:'hello', protocolVersion, pymolVersion, state, width, height, glutThread, threadIdent, gl, incentiveOnly}` |
| S→C | `{id, t:'ok', result, invalidates?, dangerous?}` |
| S→C | `{id, t:'err', error:{kind, type, message, detail?, traceback}}` |
| S→C | `{t:'event', topic, seq, payload}` |
| S→C | `{t:'feedback', lines:[...]}` |
| S→C | binary: `uint32 LE header length \| UTF-8 JSON meta (space-padded) \| bytes` |

The binary header is padded so the payload starts 4-byte aligned; that is what
lets the TypeScript decoder return a zero-copy `Float32Array` view instead of
memcpy-ing every buffer. Do not regress it.

19 topics, one owner each: `feedback` `progress` `redisplay` `pixels` `view`
`selection` `objects` `menu` `settings` `wizard` `editor` `dialog` `frame`
`scenes` `movie_panel` `seqview` `colors` `plugin` `geometry`.

Error kinds: `CmdException` `QuietException` `IncentiveOnly` `NotAllowed`
`NotSerializable` `PythonError` `PyMOLUnavailable` `NoOffscreenGL` `BadMessage`
`Timeout` `EngineNotRunning` `Shutdown`.

### The command-echo invalidation channel

Every executed command reports what it invalidated (`color` / `reps` /
`geometry` / `coords` / `names`, or `resync` for `do`/`run`/`@script`) in the
`ok` frame. This is the **only** mechanism that can see per-atom colour and
per-atom reps: polling provably cannot. `cmd.get_vis()` is object-level only —
`show spheres, m and name CA` leaves it byte-identical while 574 atoms carry the
new rep.

---

## Security

The boundary is the **transport**, not a symbol deny-list:

* bind `127.0.0.1` only (`--allow-remote` is refused by default);
* a 256-bit token minted at startup, written mode `0600` with `--token-file`,
  required on `/ws` and `/blob/{id}`;
* an `Origin` allow-list;
* a loopback peer check — the precedent is PyMOL's own HTTP bridge, which hard
  rejects non-loopback peers (`modules/pymol/pymolhttpd.py:61-68`).

`system`, `run`, `cd`, `quit`, `_ctrl`/`_alt`/`_ctsh` and `t:'do'` are all
**allowed** (plan §A6). Denying them removed six features from the parity
inventory and bought nothing: this product executes arbitrary local code by
design — it is a desktop replacement for a program with a Python console. What
the policy does instead is check *shape* (1..3 identifier segments, no dunders),
check *namespace*, merge per-work-package *grants*, take one confirmation for
`cmd.system`, route `cmd.quit` to bridge shutdown instead of the C `exit()` path
(which skips `atexit` and `Py_FinalizeEx`, `spikes/00-build.md` §6.2), and mark
every dangerous call so the UI and the log can show it.

`quiet` is **passed through, never forced to 1** (critique C4): several parity
rows depend on `quiet=0` output reaching the console.

### Adding a capability (for other work packages)

Do **not** edit `policy/base.py`. Drop a file:

```python
# bridge/tenmol_bridge/policy/grants/wp-13.py
from tenmol_bridge.policy import Grant

GRANT = Grant(
    wp="WP-13",
    note="pymol.menu.* resolution for the popup engine",
    roots={"menu"},
    invalidates={"mol_show": ("reps",)},
)
```

The loader merges every `grants/*.py` in sorted order. Same idea for
`panels/` and `state/`: those `__init__.py` barrels are **frozen** (written once
in wave 0, listing every planned module); a feature WP adds only its own module
file next to them.

---

## It runs without PyMOL, on purpose

`--no-pymol` (or `TENMOL_BRIDGE_FORCE_NO_PYMOL=1`), or simply a machine where
`import pymol` fails: the engine goes to state `degraded`, the server still
starts, `hello` reports `"state":"degraded"`, `sub`/`unsub` still work, and every
engine-bound call answers with

```json
{"id":1,"t":"err","error":{"kind":"PyMOLUnavailable","type":"PyMOLUnavailable",
 "message":"PyMOL is not available in this bridge process: ImportError: ..."}}
```

so the front-end stays developable. If PyMOL is present but no offscreen GL
context can be created, the state is `headless` instead: the console and the RPC
surface work, picking and Mode P do not.

---

## Offscreen GL

`glcontext/` is platform-dispatched:

| platform | module | status |
|---|---|---|
| `darwin` | `glcontext/cgl.py` | implemented here (CGL legacy 2.1, no drawable, one FBO) |
| `linux` | `glcontext/egl.py` | owned by the cross-platform GL work package |
| `win32` | `glcontext/wgl.py` | owned by the cross-platform GL work package |

The interface is `create_context(width, height) -> Context` with
`.make_current()`, `.resize(w, h)`, `.release()` and `.info() -> dict`. A missing
backend raises the typed `NoOffscreenGL`.

Two rules any backend must honour:

1. **Contexts are per-thread.** Create it on the engine thread. Calling
   `PyMOL_Draw` from a thread that does not hold the context segfaults at
   `glGetString` (`layer5/PyMOL.cpp:2307`).
2. **Never regenerate the FBO on resize.** `check_gl_stereo_capable` latches
   `G->ShaderMgr->defaultBackbuffer.framebuffer` from `GL_FRAMEBUFFER_BINDING` at
   the first draw (`layer5/PyMOL.cpp:2236-2239`). `resize()` re-storages the
   attachments of the same FBO name.

macOS caveats: hardware CGL contexts need a WindowServer connection, so a
`launchd` *daemon* (as opposed to a per-user agent) may fail; and one benign
driver line — `UNSUPPORTED (log once): POSSIBLE ISSUE: unit 0
GLD_TEXTURE_INDEX_2D is unloadable...` — appears on every start.

---

## Tests

```bash
cd bridge && /path/to/venv/bin/python -m pytest -q
```

`-s` is mandatory and is in `addopts`: pytest's output capture re-assigns
`sys.stdout` around every test phase, which silently un-installs `pcatch` and
makes the Python half of the console vanish. `conftest.py` refuses to run
without it.

`pymol2.SingletonPyMOL` can only start once per process, so all engine tests
share one session-scoped bridge — a real uvicorn server on a real loopback port,
driven over a real WebSocket. GL-dependent tests are marked `gl` and skip
themselves when no context can be created; gate them in CI the way the ray
image-diff tests are gated.

`test_process_model.py` is the WP-02 acceptance suite (plan gate 0 → 1): it
drags the mouse and asserts `get_view()[:9]` changed, asserts the feedback drain
carries both `PyMOL>print(...)` and the printed value, runs `cmd.mpng` and
asserts the engine still answers, asserts `glutThread == threadIdent`, and
asserts no bridge log line leaks into the console.
