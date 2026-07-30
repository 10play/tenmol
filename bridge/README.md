# tenmol-bridge

The PyMOL side of the tenmol web client. One process, one PyMOL engine, one
dedicated PyMOL thread, one local browser, one WebSocket.

```
browser  ──ws://127.0.0.1:8765/ws──▶  uvicorn/asyncio thread
                                          │ queue (FIFO)
                                          ▼
                                     pump thread ──▶ pymol2.SingletonPyMOL
                                          │              (the ONLY thread that
                                          ▼               ever touches PyMOL)
                                     feedback drain ──▶ fan-out to sessions
```

## Run it

```bash
# from the repo root; needs a venv with PyMOL built from this tree
# (docs/webclient/spikes/00-build.md §8)
TENMOL_VENV=/path/to/venv scripts/dev-bridge.sh
# ...or, if the venv is at bridge/.venv or ./.venv:
scripts/dev-bridge.sh
scripts/dev-bridge.sh --port 9000 --tick refresh --quiet
python -m tenmol_bridge --help
```

`GET /healthz` returns the pump status (state, PyMOL version, tick strategy,
`pmgui`, tick count, the pump thread's ident and `pymol.glutThread`).

### It runs without PyMOL, on purpose

If `import pymol` fails, the pump goes to state `degraded`, the server still
starts, `hello` reports `"pymolVersion": "unavailable"`, `sub`/`unsub` still
work, and every `call`/`do` is answered with

```json
{"id":1,"t":"err","error":{"type":"PyMOLUnavailable",
 "message":"PyMOL is not available in this bridge process: ImportError: ..."}}
```

so the front-end is developable on a machine that has never built PyMOL. Set
`TENMOL_BRIDGE_FORCE_NO_PYMOL=1` to force that path on a machine that does.

## Protocol

Protocol v1, frozen. See `tenmol_bridge/topics.py` for the constants; the
TypeScript side mirrors the same strings. Text frames are JSON:

| direction | frame |
|---|---|
| C→S | `{"id":n,"t":"call","fn":"fragment","args":[...],"kwargs":{...}}` |
| C→S | `{"id":n,"t":"do","cmd":"turn x, 10"}` |
| C→S | `{"t":"input","kind":"button"\|"drag"\|"reshape",...}` |
| C→S | `{"id":n,"t":"sub"\|"unsub","topic":"..."}` |
| S→C | `{"t":"hello","pymolVersion":"3.2.0a","protocolVersion":1}` |
| S→C | `{"id":n,"t":"ok","result":...}` / `{"id":n,"t":"err","error":{type,message,traceback}}` |
| S→C | `{"t":"event","topic":"...","seq":n,"payload":...}` |
| S→C | `{"t":"feedback","lines":["..."]}` |

Binary frames are server→client only: `uint32 LE header length | UTF-8 JSON
metadata | raw typed-array bytes` (`topics.encode_binary_frame`).

Topics: `objects view frame selection settings feedback geometry`. Nothing else
is accepted; a `sub` to anything else returns `err/UnknownTopic`.

Ordering: a message is submitted to the pump queue synchronously in receive
order, and its reply is awaited on a background task, so replies can arrive out
of order (each carries its `id`) but the **engine** always sees commands in the
order the client sent them.

## Security posture — read this, it is deliberate

**This is a local desktop replacement, not a hosted service.** It binds
127.0.0.1 (`--host` refuses anything else without `--allow-remote`), serves one
browser, and runs as the user who started it. That user can already type
`system rm -rf ~` into PyMOL's own command line. Sandboxing the bridge would
not add security; it would only remove features.

Concretely, these are **permitted** and marked, not blocked:

| symbol | why it must work |
|---|---|
| `cmd.run`, `do "@file"` | File > Run Script (`modules/pymol/_gui.py:118`); the demo wizard runs `run $PYMOL_DATA/demo/cgo03.py` (`modules/pymol/wizard/demo.py:195`) |
| `cmd.cd`, `cmd.pwd` | File > Working Directory |
| `cmd.system` | File > Working Directory > File Browser |
| `cmd.quit` / `cmd._quit` | File > Quit |
| `cmd.load` / `cmd.save` / `cmd.png` | all file I/O |
| `cmd.alter`, `iterate`, `alter_state` | evaluate Python per atom; core features |
| `cmd._ctrl` / `_alt` / `_ctsh` / `_special` | the ortho CLI chord fallback (`modules/pymol/internal.py:488,494,509`, registered in `keywords.py:46`) |
| `t:"do"` (raw command lines) | **every** popup-menu leaf and wizard button in PyMOL is literally a command string (`layer4/PopUp.cpp:471-475`, `modules/pymol/menu.py:824`) |

A deny-list of the "obviously dangerous" names — which is what
`01-architecture.md:357-364` proposed — deletes File>Run Script, the working
directory commands, quit, and the entire menu and wizard systems. That is
`02-completeness-critique.md` §A6, and it is why this bridge does not have one.

What the allow-list in `dispatch.py` actually does is **surface control**, so a
stray tab, a mis-typed `fn`, or a malicious page that gets a socket cannot walk
into arbitrary Python:

1. `fn` must be 1–3 dotted identifier segments.
2. No segment may start with `__` (blocks `__globals__` / `__class__` walks).
3. A bare name resolves inside `pymol.cmd` — the same namespace the PyMOL
   command line has, and nothing more.
4. A dotted name's root must be one of
   `cmd util editor preset movie menu wizard plugins invocation`. `os.system`,
   `subprocess.run`, `builtins.eval` are unreachable.
5. A leading-underscore leaf must be on `dispatch.ALLOWED_PRIVATE`.
6. The result must be a callable and must not be a class.

Every symbol in `dispatch.DANGEROUS` (and every raw `do` line starting with
`run`/`@`/`system`/`cd`/`quit`/`spawn`/`alias`) is logged as
`[tenmol-bridge] DANGEROUS <fn> - <why>` and reported through
`Dispatcher.on_dangerous` so the UI can surface it. `--no-dangerous` refuses
them instead — which is a *deliberately broken* mode, useful only for tests.

Not claimed: isolation from a hostile local process. Anything that can open a
socket to 127.0.0.1:8765 has the user's privileges through this bridge. If that
matters for your deployment, this is the wrong program.

## The two open blockers, and how this skeleton is structured around them

### Spike 01 — the per-tick draw

`pump.tick_draw()` is the single place the pump draws/refreshes. Swapping it is
`--tick <name>`; adding a candidate is one decorated function.

Measured on darwin/arm64 with PyMOL 3.2.0a0 (one `ala` fragment,
`reshape(640,480,1)`, left-press + 11 drags + release, then `get_view`):

| `--tick` | `pmgui` | viewport input | notes |
|---|---|---|---|
| `idle` (default) | 1 | **dead** | safe; `idle()` + `getRedisplay()` only |
| `refresh` | 1 | **dead** | survived; reaches `ExecutiveDrawNow`, still nothing |
| `refresh_always` | 1 | **dead** | 461 ticks, no crash, still nothing |
| `draw` | 1 | — | **refused at startup**: guaranteed SIGSEGV |
| `draw` | 0 (`--no-pmgui`) | **works, rotation applied** | but console feedback is silent |

Why `refresh` is not enough: `OrthoExecDeferred` (the drain for click/drag/
deferred png/deferred ray, `layer1/Ortho.cpp:268-277`) is called only by
`ExecutiveDrawNow`, *and* is gated on `PyMOL_GetIdleAndReady`
(`layer3/Executive.cpp:11521`) which is `IdleAndReady == 3`
(`layer5/PyMOL.cpp:2560-2562`, `IDLE_AND_READY` at `:105`). `IdleAndReady` only
increments in `PyMOL_Idle` while `DrawnFlag` is set (`:2413-2415`), and
`DrawnFlag` is only ever set inside `PyMOL_Draw` (`:2325` GUI branch, `:2328`
non-GUI branch). **A process that never calls `draw()` never becomes
idle-and-ready, so its deferred queue is never drained** — no matter how often
`cmd.refresh()` runs.

And `draw()` is safe with `pmgui=0` for the same reason it crashes with
`pmgui=1`: the GL prologue (`PyMOL_PushValidContext`, `setup_gl_state`,
`glGetString`) is inside `if (G->HaveGUI)` at `layer5/PyMOL.cpp:2302`, and
`HaveGUI == Option->pmgui` (`:2248`).

### Spike 02 — the feedback half of the same trade-off

`OrthoFeedbackIn` drops everything unless `pmgui` (`layer1/Ortho.cpp:493-497`,
`pmgui = !no_gui` at `layer1/P.cpp:1820`). Measured: with `pmgui=1`,
`cmd._get_feedback()` returned 22 lines including the splash banner and the
`PyMOL>turn x, 10` echo; with `pmgui=0` it returned **0**.

So the two blockers are one blocker:

* `pmgui=1` → console works, viewport input dead, `draw()` fatal.
* `pmgui=0` → viewport input works, `draw()` safe, console silent.

Neither is a shippable product. Somebody has to pay for the other half — a
stdout/stderr tee, or a change to `OrthoFeedbackIn`'s gate. `feedback.py` takes
*sources*, plural, so adding a tee does not touch the pump or the server.

Separately, and already measured: Python-level `print()` from `cmd.do` goes to
the process stdout and **not** into the Ortho queue, so a console built only on
`_get_feedback` misses every `print` from scripts, wizards and `util.*`.

### Why the pump exists at all (critique A4)

`locking.is_gui_thread()` is `gui_ident is None or gui_ident == get_ident()`
(`modules/pymol/locking.py:80-86`) and `pymol.glutThread` is `None` under
`pymol2.SingletonPyMOL` — so without intervention **every** thread claims to be
the GUI thread and `cmd.refresh` / `cmd.sync` / `cmd.do` flushing run inline on
whatever uvicorn worker calls them. `pump._boot()` assigns
`pymol.glutThread = threading.get_ident()` on the pump thread before starting
the engine, and re-asserts it afterwards. `/healthz` shows both idents so you
can check they match.

## Layout

| file | owns |
|---|---|
| `tenmol_bridge/topics.py` | protocol constants, frame builders, binary framing, per-connection subscriptions |
| `tenmol_bridge/pump.py` | the PyMOL thread, the FIFO task queue, `tick_draw` and the tick strategies |
| `tenmol_bridge/feedback.py` | the single consume-once feedback drain + fan-out + backlog |
| `tenmol_bridge/dispatch.py` | `fn` → callable resolution, the allow-list policy, JSON coercion |
| `tenmol_bridge/server.py` | FastAPI app, `/ws`, `/healthz`, per-connection session |
| `tenmol_bridge/__main__.py` | CLI |

Dependencies: `fastapi`, `uvicorn`, `websockets`. `pymol` is deliberately not a
declared dependency — it is built from this repo, not fetched from an index.

## Known gaps (skeleton, not product)

* No `event` producer yet: `sub`/`unsub` are wired and sequence-numbered, but
  only `feedback` currently emits. The topics `objects view frame selection
  settings geometry` need their pollers (later WPs).
* `dispatch.to_jsonable` is a coercion, not a codec table. `get_model()`,
  `get_session()`, `get_coords()` need typed encoders (critique B8); note
  `get_coords(..., copy=0)` returns a live view onto C++ memory
  (`layer2/CoordSet.cpp:326-361`) — it must be copied before it leaves the pump
  thread, which `to_jsonable` does via `tolist()`.
* No tests directory yet; verification so far is a live server plus a scripted
  WebSocket client.
* `cmd.mpng` / `movie.produce` will arm `ModalDraw` and, with a non-drawing
  tick, wedge the engine permanently (critique A2, `layer5/PyMOL.cpp:93,2466`).
  Not handled here.
