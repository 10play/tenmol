# Spike 02 — Headless feedback capture

> ## STATUS — re-verified on 2026-08-02: **STILL TRUE, IN FULL**
>
> This is the spike that has aged best. §1's two rules are implemented verbatim in
> `packages/bridge/tenmol_bridge/engine.py`, with this file's reasoning in the comments beside
> them: `options.no_gui = 0` at `:125` (with `-c` explicitly rejected at `:121-123`),
> `options.internal_gui = 0` / `internal_feedback = 0` at `:129-130`, `pymol2.SingletonPyMOL()`
> at `:142` under a comment that repeats §1 rule 2, and `_install_pcatch()` at `:162`. §9's
> ordering trap — uninstall `pcatch` **before** `p.stop()`, because `SingletonPyMOLGlobals` is
> nulled first — is at `:404-407` and cites "spike 02 §9".
>
> §9's `FeedbackCapture` was a *reference* implementation; the shipped code is
> `tenmol_bridge/feedback.py` + `engine.py`, not a copy of it. The behaviours §4 and §8 pin —
> destructive single-consumer read, `None` (not `[]`) on a lock miss, the unbounded queue, the
> ~1018-char hard split, the line-prefix classification table — are the reason that module has
> the shape it has.
>
> Two citation fixes, made in place below: §11 items 1 and 2 pointed at an
> `"action item (3)"` of `00-build.md` that has never existed; the finding they mean is
> `00-build.md` §5.1/§5.3 and its recommendations are §7.

**Status: BLOCKER RESOLVED.** Full PyMOL console parity is achievable headless, with **zero C++
changes**, provided the bridge does two specific things. Both are non-obvious and both are the
opposite of what the current build/architecture docs assume.

| | |
|---|---|
| Interpreter | `/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad/venv/bin/python` |
| PyMOL | 3.2.0a0, git `159ed88baad87f6bcc61ee45ef0b9ffc208370fc` |
| Python / OS | CPython 3.13.3, macOS 15 arm64 |
| Experiment scripts | `/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad/fb/e*.py`, `feedback_capture.py`, `test_feedback_capture.py` |
| New C++ needed | **No** |

---

## 1. The answer in two rules

**Rule 1 — never pass `-c`.** `OrthoFeedbackIn()` is gated on `G->Option->pmgui`
(`packages/engine/layer1/Ortho.cpp:492-499`). `pmgui` is set from `!options.no_gui` (`packages/engine/layer1/P.cpp:1820`), and
`-c` sets `no_gui=1` (`packages/engine/modules/pymol/invocation.py:401`). Start with `no_gui = 0` and suppress the
GUI by simply never creating a GL context and never calling `_draw`.

**Rule 2 — use `pymol2.SingletonPyMOL`, not `pymol2.PyMOL`.** The `pcatch` stdout hook writes
through the file-scope `SingletonPyMOLGlobals` pointer (`packages/engine/layer1/P.cpp:2667`). With a non-singleton
instance that pointer is `nullptr`, so `pcatch` **silently discards every `print()`** — worse than
not installing it. `pmg_qt` already does the right thing: `packages/engine/modules/pmg_qt/pymol_gl_widget.py:3`
is `from pymol2 import SingletonPyMOL as PyMOL`.

`HaveGUI` is only assigned from `pmgui` inside `PyMOL_DrawWithoutLock()`
(`packages/engine/layer5/PyMOL.cpp:2244-2248`), which a headless bridge never calls. So `no_gui=0` costs nothing:
`ray`, `png`, `refresh`, `idle`, scenes, movies and `reshape` all still work with no GL context
(verified, §6).

---

## 2. Route-by-route results

Every row below was executed. "user-visible" = the exact text the Qt feedback pane shows.

| Route | C-origin lines (`Executive:`, `Ray:`, `Selector-Error:`) | Python-origin lines (`print`, tracebacks, ` count_atoms: N atoms`) | Verdict |
|---|---|---|---|
| `cmd._get_feedback()`, started with `-cq` (`no_gui=1`) | ❌ `[]` forever | ❌ `[]` forever | **Dead. The blocker, confirmed.** |
| `cmd._get_feedback()`, `no_gui=0`, no `pcatch` | ✅ | ❌ (goes to real stdout only) | Partial |
| `cmd._get_feedback()`, `no_gui=0`, **`pcatch._install()`**, **SingletonPyMOL** | ✅ | ✅ | **✅ THE ANSWER — full parity** |
| same but `pymol2.PyMOL()` (non-singleton) | ✅ | ❌ **output vanishes entirely** (not even on stdout) | Actively harmful |
| `pymol.invocation.options.no_gui = 0` set *after* `start()` | ❌ | ❌ | Too late — options are snapshotted at `_cmd._new` |
| `cmd.feedback(...)` settings | verbosity control only | see §5 | Not a capture route |
| plain `sys.stdout` replacement (pure-Python) | ❌ (C `printf` goes to fd 1) | ✅ | Loses C output + loses interleaving |
| `os.dup2` fd-level capture | ✅ | ✅ | Works even under `-cq`, but see §7 |
| `cmd.log_open()` / `logging` setting | ❌ | ❌ | Logs **input commands only**, never output |

### 2a. The `-cq` blocker, reproduced (`e3_cq.py`)

```
no_gui = 1
---- start : []
PyMOL>fragment ala
 Executive: object "ala" created.
---- fragment : []
PyMOL>print("hi")
hi
---- print : []
PyMOL>count_atoms all
 count_atoms: 10 atoms
---- count : []
```

Text appears on the terminal; `_get_feedback()` is empty every single time. `pcatch` was installed
here and did not help — the gate is upstream of it, in `OrthoFeedbackIn`.

### 2b. The working route (`e2_pcatch.py`)

```
sys.stdout after install : <module 'pcatch'> is pcatch: True
---- fragment ala   : ['PyMOL>fragment ala', ' Executive: object "ala" created.']
---- print via do   : ['PyMOL>print("hello-from-do")', 'hello-from-do']
---- bare print     : ['hello-from-bare-print']
---- bad command    : ['PyMOL>this_is_a_bad_command', "NameError: name 'this_is_a_bad_command' is not defined"]
---- count_atoms    : ['PyMOL>count_atoms all', ' count_atoms: 10 atoms']
---- bad load       : ['PyMOL>load /nonexistent/file.pdb', ' Error: failed to open file "/nonexistent/file.pdb"']
---- help fragment  : ['PyMOL>help fragment', ' ', 'DESCRIPTION', ' ', '    "fragment" retrieves a 3D structure from the fragment library,', ...]
---- iterate        : ['PyMOL>iterate first all, print(name, resn)', 'N ALA', ' Iterate: iterated over 1 atoms.']
```

Note the `iterate` line: the user's `print` output (`N ALA`) is correctly **interleaved between**
the prompt echo and the C-level summary. That interleaving is the reason to use `pcatch` rather
than a separate Python-side tee — both streams pass through the same `OrthoAddOutput` line buffer.

### 2c. The non-singleton trap (`e4_nonsingleton.py`)

```
---- fragment (no pcatch) : ['PyMOL>fragment ala', ' Executive: object "ala" created.']
stdout is pcatch: True
---- print (with pcatch)  : ['PyMOL>print("hi-nonsingleton")']      <-- 'hi-nonsingleton' GONE
---- bare print           : []                                       <-- GONE
---- count_atoms          : ['PyMOL>count_atoms all']                <-- ' count_atoms: 10 atoms' GONE
```

Those strings appear neither in the feedback queue nor on the terminal. They are dropped by
`PCatchWrite`'s `if(SingletonPyMOLGlobals)` guard.

---

## 3. How the Qt GUI does it today

* `packages/engine/modules/pmg_qt/pymol_gl_widget.py:3` — `from pymol2 import SingletonPyMOL as PyMOL`
* `packages/engine/modules/pmg_qt/pymol_gl_widget.py:99-105` — `self.pymol.start()` then `import pcatch;
  pcatch._install()`
* `packages/engine/modules/pmg_qt/pymol_qt_gui.py:391-394` — a `QTimer` (single-shot, 100 ms initially)
* `packages/engine/modules/pmg_qt/pymol_qt_gui.py:941-958` — `update_feedback()`:
  `feedback = self.cmd._get_feedback()` → `colorprinting.text2html('\n'.join(feedback))` →
  `browser.appendHtml(...)` → `feedback_timer.start(500)`
* `packages/engine/modules/pmg_qt/pymol_qt_gui.py:964` — after each typed command, `feedback_timer.start(0)` for
  an immediate drain.

**Every part of this path is available headless.** Nothing in it touches Qt, GL, or `_draw`. The
web bridge is a 1:1 translation: replace `QTimer` with a poller thread / asyncio task, replace
`text2html` + `appendHtml` with an SSE or WebSocket stream of JSON line records.

`colorprinting.error/warning/suggest` are plain `print` in open source
(`packages/engine/modules/pymol/colorprinting.py:29-32`), and `colored_feedback` reports
`" Setting-Warning: colored_feedback is not supported in Open-Source version of PyMOL"` — so
**feedback lines contain no ANSI escapes** and the React client needs no ANSI parser. (Belt and
braces: `OrthoFeedbackOut` strips ANSI when `colored_feedback` is off, `packages/engine/layer1/Ortho.cpp:502-516`.)

---

## 4. Consume-once semantics — CONFIRMED DESTRUCTIVE

`packages/engine/modules/pymol/internal.py:593-606` loops `_cmd.get_feedback()` until it returns empty;
`packages/engine/layer4/Cmd.cpp:3892` calls `OrthoFeedbackOut`, which does `front()` + `pop()`
(`packages/engine/layer1/Ortho.cpp:502-516`). Measured (`e5b.py`):

```
consume1: ['PyMOL>print("LINE-A")', 'LINE-A']
consume2: []
consume3: []
empty type: list []
```

Consequences the bridge design **must** honour:

1. **Exactly one consumer per process.** If the HTTP handler and a background poller both call
   `_get_feedback()`, lines are split randomly between them. Route everything through one owner.
2. **PyMOL keeps no scrollback for you.** (`I->Line[]` is a 256-entry ring, `OrthoSaveLines 0xFF`
   at `packages/engine/layer1/Ortho.cpp:62`, but it is not readable from Python.) The bridge must own the ring
   buffer so a reloading browser tab can replay history.
3. **The queue is unbounded until drained.** 5000 `cmd.do('print(...)')` calls with no drain
   produced a single `_get_feedback()` returning **10000 lines** with nothing dropped (`e5_semantics.py`).
   Good for correctness, but it is a memory leak if the poller ever stops. Keep polling.
4. **It can return `None`, not `[]`.** `internal._get_feedback` returns `None` when
   `lock_attempt` fails. Observed 1 `None` in ~100 polls while the main thread was rendering
   (`e6_thread.py`). `if not fb:` treats `None` and `[]` identically and is fine for skipping,
   but never do `lines.extend(fb)` without the `None` check.

---

## 5. `cmd.feedback()` interaction — a genuine trade-off

The terminal `printf` in `OrthoNewLine` (`packages/engine/layer1/Ortho.cpp:1160-1169`) is gated on
`Feedback(G, FB_Python, FB_Output)`. So is `PCatchWrite` (`packages/engine/layer1/P.cpp:2668`). Measured
(`e14_mute.py`), after `cmd.feedback("disable","python","output")`:

```
### AFTER mute
C-origin queue:  ['PyMOL>fragment gly', ' Executive: object "gly" created.']   # still queued
py-origin queue: ['PyMOL>print("py-after-mute")']                              # 'py-after-mute' LOST
```
and the terminal printed nothing at all.

* Muting stops the duplicate echo on the launching terminal **and keeps C-origin lines** in the
  queue…
* …but it **kills Python-origin capture entirely**.

**Recommendation: leave `python/output` enabled** and accept that the terminal PyMOL was launched
from also shows the console text. For a local desktop-replacement that is a feature, not a bug.
Per-module verbosity control (`cmd.feedback("disable","executive","actions")` etc.) works normally
and affects the queue as expected — verified in `e5_semantics.py`.

---

## 6. `no_gui=0` does not break headless operation

`e9_pipeline.py` / `e10_opts.py`, SingletonPyMOL with `no_gui=0`, no GL context anywhere:

```
version ('3.2.0a', 3.0, 3000000, 1785422035, '159ed88...', 0)
atoms 10
ray 0.006s
png bytes 2645
idle() 0
getRedisplay 1
refresh() ok
scene ok (1.0, 0.0, 0.0)
reshape ok (580, 582)      <-- see below
movie ok frame 5
STOPPED OK
```

**Gotcha:** with `no_gui=0`, `internal_gui` and `internal_feedback` default to 1 and PyMOL reserves
screen real estate for its own overlay — `reshape(800,600)` yielded a viewport of **(580, 582)**,
not (800, 600). Setting `internal_gui = 0` and `internal_feedback = 0` before `start()` restores
the exact viewport **without affecting feedback capture** (`e10_opts.py`):

```
viewport: (800, 600)
feedback: ['PyMOL>fragment ala', ' Executive: object "ala" created.',
           'PyMOL>print("still-captured")', 'still-captured',
           'PyMOL>nope_nope', "NameError: name 'nope_nope' is not defined"]
```

`OrthoFeedbackIn` only reads `pmgui`; `internal_feedback` is used solely to decide whether to mark
the ortho layer dirty (`packages/engine/layer1/Ortho.cpp:1119-1122`).

---

## 7. Fallback route (documented, not recommended): fd-level `dup2`

`e8_fd.py` — pipe over fd 1 + reader thread, under `-cq`:

```
get_feedback under -cq: []
fd-captured lines: 8
  | PyMOL>fragment ala
  |  Executive: object "ala" created.
  | PyMOL>count_atoms all
  |  count_atoms: 10 atoms
  | PyMOL>print("py-print")
  | py-print
  | PyMOL>bogus_cmd
  | NameError: name 'bogus_cmd' is not defined
```

It works, and it is the only route that works under `-c`. Reject it anyway: it needs a dedicated
reader thread or the 64 KiB pipe buffer will deadlock PyMOL mid-render; it swallows the process's
real stdout so server logs become indistinguishable from console text; and it gives up the
`pmgui`-gated queue's clean line framing. Keep it in the back pocket only if a future PyMOL build
must run with `-c`.

---

## 8. Behavioural details the web client must handle

All measured in `e11_edge.py` / `e12_long.py` / `e13_classes.py`.

* **Synchronous availability.** 500 iterations of `cmd.do(...)` + immediate `_get_feedback()`:
  `0/500 drains missed their own line`. On a single thread, feedback for a command is complete by
  the time `cmd.do` returns. No settling delay needed.
* **Cross-thread polling works.** A poller thread drained 407 lines including all 200 `T-*` lines
  while the main thread ran `fragment`/`show surface`/`ray`; 1 `None` return (`e6_thread.py`).
* **Direct API calls are quiet; `cmd.do` is not.** `cmd.fragment('ala')` produced `[]`, while
  `cmd.do('fragment ala')` produced `' Executive: object "ala" created.'`. **Route user-typed
  commands through `cmd.do()`** — that is where console parity lives. Programmatic calls made by
  the React UI (button clicks) should call the typed API and will correctly stay silent, or use
  `cmd.do` if you want them echoed like the Qt command line does.
* **`echo=0`** (`cmd.do(x, echo=0)`) suppresses the `PyMOL>` echo line but keeps the output.
* **Long lines are hard-split at ~1018 chars** regardless of `wrap_output` (default `off`);
  `OrthoLineLength` fail-safe at `packages/engine/layer1/Ortho.cpp:1097-1104`. A 20000-char write became 20
  feedback entries totalling exactly 20000 chars — no loss, but no 1:1 line mapping. Do not assume
  one feedback entry == one logical line for huge output.
* **Partial writes are buffered until a newline.** `sys.stdout.write("PARTIAL")` yields `[]`;
  the subsequent `write("-CONTINUED\n")` yields `['PARTIAL-CONTINUED']`.
* **stderr is captured too** — `pcatch._install()` sets `sys.stderr = sys.stdout = pcatch`.
* **Full multi-line tracebacks come through**, one feedback entry per traceback line, including the
  Python 3.13 `~~~~^^^^` caret lines (`e6.out`).
* **UTF-8 is fine**: `['PyMOL>print("ångström Å 你好")', 'ångström Å 你好']`.
* **Progress bars are NOT in the feedback stream.** `pmg_qt` polls `cmd.get_progress()` separately
  (`pymol_qt_gui.py:942` → `update_progress`). `cmd.get_progress()` returns `-1.0` when idle. The
  web client needs its own progress channel.
* **`cmd.log_open()` is not a capture route.** Verified contents for a `.pml` log:
  `fragment ala\ncount_atoms all\nprint("logged?")` — input echo only, zero output. `.py` logs
  give `cmd.do('''fragment gly''')`. Useful for session replay, useless for the console pane.

### Observed line prefixes for client-side classification (`e13.out`)

| kind | real examples |
|---|---|
| prompt | `PyMOL>fragment ala` |
| error | `" Error: Unknown color."`, `" Selector-Error: Invalid selection name ..."`, `" ScenePNG-Error: error writing ..."`, `"Error: unknown Setting: 'nonexistent_setting'."`, `"NameError: ..."`, `"ZeroDivisionError: ..."`, `"Traceback (most recent call last):"` |
| warning | `" Setting-Warning: colored_feedback is not supported in Open-Source version of PyMOL"` |
| info | `" Executive: object \"ala\" created."`, `" Selector: selection \"foo\" defined with 0 atoms."`, `" Ray: render time: 0.00 sec. ..."`, `" ExecutiveAlign: invalid selections for alignment."`, `" count_atoms: 10 atoms"` |

Note the caret continuation lines (`"( ( ( (<--"`, `"nonexistent_object<--"`) that follow selection
errors — they must be rendered with the preceding error line to be intelligible.

---

## 9. Deliverable — runnable capture module

Verified working end-to-end (§10). Drop this in the bridge package (owner's choice of path; this
spike creates no code files).

```python
"""
Headless PyMOL console-feedback capture for the web client bridge.

Verified against pymol 3.2.0a0 (git 159ed88), CPython 3.13.3, macOS arm64.

Why this shape (all empirically established, see docs/spikes/feedback.md):

  * packages/engine/layer1/Ortho.cpp:492-499 -- OrthoFeedbackIn() only queues when G->Option->pmgui.
    pmgui is derived from `not invocation.options.no_gui` (packages/engine/layer1/P.cpp:1820).
    `pymol -c` sets no_gui=1 (packages/engine/modules/pymol/invocation.py:401), so a "-c" bridge gets
    _get_feedback() == [] forever.  ==> we must NOT use -c; we set no_gui=0 and instead
    suppress the GUI by never creating a GL context / never calling _draw.

  * C-level messages (Executive/Selector/Ray/Setting/Error) reach the queue on their own.
    Python-level output (print, tracebacks, ' count_atoms: N atoms', ' Error: Unknown color.')
    only reaches it if the built-in `pcatch` module is installed as sys.stdout/sys.stderr.

  * pcatch writes via SingletonPyMOLGlobals (packages/engine/layer1/P.cpp:2667). With a NON-singleton
    pymol2.PyMOL() that pointer is null and pcatch silently DISCARDS every print().
    ==> must use pymol2.SingletonPyMOL (this is exactly what pmg_qt does:
    packages/engine/modules/pmg_qt/pymol_gl_widget.py:3,99-105).

  * cmd._get_feedback() is a DESTRUCTIVE read (packages/engine/modules/pymol/internal.py:593 loops
    _cmd.get_feedback until empty).  Exactly one consumer may exist in the process, and
    that consumer must own the scrollback.  It returns None (not []) when the API lock
    is busy -- observed once in ~100 polls during a busy render.
"""

import itertools
import re
import sys
import threading
import time
from collections import deque

__all__ = ["FeedbackCapture", "classify"]


# ---------------------------------------------------------------- classification
_RE_ERROR = re.compile(
    r"^(?:"
    r"\s*Error:"                      # " Error: Unknown color."
    r"|\s*\w+-Error:"                 # " Selector-Error:", " ScenePNG-Error:"
    r"|Traceback \(most recent call last\):"
    r"|\s*\w*(?:Error|Exception):"    # "NameError: ...", "ZeroDivisionError: ..."
    r")"
)
_RE_WARNING = re.compile(r"^\s*(?:\w+-)?Warning:")
_RE_PROMPT = re.compile(r"^PyMOL>")


def classify(line: str) -> str:
    """'prompt' | 'error' | 'warning' | 'info' -- prefixes verified against real output."""
    if _RE_PROMPT.match(line):
        return "prompt"
    if _RE_ERROR.match(line):
        return "error"
    if _RE_WARNING.match(line):
        return "warning"
    return "info"


# ---------------------------------------------------------------- capture
class FeedbackCapture:
    """Owns the single PyMOL instance + the single feedback consumer.

    Usage:
        fc = FeedbackCapture()
        fc.start()                       # configures options, starts PyMOL, installs pcatch
        cmd = fc.cmd
        cmd.do('fragment ala')
        seq, lines = fc.since(0)         # lines == [{'seq':int,'kind':str,'text':str}, ...]
        fc.stop()
    """

    def __init__(self, ring_size=20000, poll_interval=0.05, splash=False):
        self.ring_size = ring_size
        self.poll_interval = poll_interval
        self.splash = splash
        self._buf = deque(maxlen=ring_size)
        self._seq = itertools.count(1)
        self._lock = threading.Lock()
        self._cv = threading.Condition(self._lock)
        self._thread = None
        self._stop = threading.Event()
        self._installed = False
        self._real_stdout = None
        self._real_stderr = None
        self.pymol = None
        self.cmd = None
        self.lock_busy_count = 0

    # -- lifecycle ---------------------------------------------------------
    def configure_options(self):
        """MUST run before SingletonPyMOL().start()."""
        import pymol

        o = pymol.invocation.options
        o.no_gui = 0            # => G->Option->pmgui = 1 => OrthoFeedbackIn queues
        o.internal_gui = 0      # otherwise steals 220 px of viewport width
        o.internal_feedback = 0 # otherwise steals viewport height
        o.external_gui = 0
        o.show_splash = 1 if self.splash else 0
        o.read_stdin = 0
        o.sigint_handler = 0    # a server owns its own signal handling
        return o

    def start(self):
        import pymol2

        self.configure_options()
        self.pymol = pymol2.SingletonPyMOL()
        self.pymol.start()
        self.cmd = self.pymol.cmd
        self._install_pcatch()
        self._drain_once()  # absorb splash/banner
        self._thread = threading.Thread(
            target=self._poll_loop, name="pymol-feedback", daemon=True)
        self._thread.start()
        return self

    def _install_pcatch(self):
        import pcatch

        self._real_stdout, self._real_stderr = sys.stdout, sys.stderr
        pcatch._install()  # sets sys.stderr = sys.stdout = pcatch
        self._installed = True

    def _uninstall_pcatch(self):
        # CRITICAL: pcatch after p.stop() drops everything on the floor
        # (SingletonPyMOLGlobals is nulled in packages/engine/layer5/PyMOL.cpp:2075-2076).
        if self._installed:
            sys.stdout, sys.stderr = self._real_stdout, self._real_stderr
            self._installed = False

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._drain_once()
        self._uninstall_pcatch()
        if self.pymol is not None:
            self.pymol.stop()
            self.pymol = None

    # -- server-side logging that must NOT land in the PyMOL console -------
    @property
    def server_stdout(self):
        """Real process stdout, for the web server's own logs."""
        return self._real_stdout or sys.__stdout__

    # -- consumer ----------------------------------------------------------
    def _drain_once(self):
        fb = self.cmd._get_feedback()
        if fb is None:            # API lock busy; caller should retry
            self.lock_busy_count += 1
            return 0
        if not fb:
            return 0
        with self._cv:
            for text in fb:
                self._buf.append({
                    "seq": next(self._seq),
                    "kind": classify(text),
                    "text": text,
                })
            self._cv.notify_all()
        return len(fb)

    def _poll_loop(self):
        while not self._stop.is_set():
            try:
                self._drain_once()
            except Exception:  # never let the poller die
                pass
            self._stop.wait(self.poll_interval)

    def pump(self):
        """Synchronous drain, for callers that do not want the poller thread."""
        return self._drain_once()

    def since(self, seq):
        """Return (last_seq, [entries with seq > `seq`]).  Non-destructive; safe for
        reconnecting/multiple web clients because we, not PyMOL, own the scrollback."""
        with self._lock:
            out = [e for e in self._buf if e["seq"] > seq]
            last = self._buf[-1]["seq"] if self._buf else seq
        return last, out

    def wait_for(self, seq, timeout=25.0):
        """Long-poll / SSE helper: block until something newer than `seq` exists."""
        deadline = time.time() + timeout
        with self._cv:
            while True:
                if self._buf and self._buf[-1]["seq"] > seq:
                    break
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                self._cv.wait(remaining)
        return self.since(seq)
```

### Wiring notes for the bridge owner

* `FeedbackCapture` must be the **only** thing in the process that calls `cmd._get_feedback()`.
* Serve the console over SSE/WebSocket by looping `wait_for(last_seq)` and emitting the returned
  entries; the client sends back the highest `seq` it has, so a page reload replays cleanly from
  the ring buffer.
* Use `fc.server_stdout` for uvicorn/`logging` output, or configure logging handlers **before**
  `fc.start()`; anything written to `sys.stdout` after `start()` lands in the PyMOL console pane.
* `fc.stop()` restores `sys.stdout` **before** `pymol.stop()`. Reversing that order makes all
  subsequent prints disappear.

---

## 10. Verification transcript of the deliverable

`test_feedback_capture.py`, exit 0:

```
last_seq = 18  n = 18
  prompt   PyMOL>fragment ala
  info      Executive: object "ala" created.
  prompt   PyMOL>count_atoms all
  info      count_atoms: 10 atoms
  prompt   PyMOL>print("hello world")
  info     hello world
  prompt   PyMOL>color notacolor, all
  error     Error: Unknown color.
  prompt   PyMOL>nope_nope
  error    NameError: name 'nope_nope' is not defined
  prompt   PyMOL>set colored_feedback, 1
  info      Setting: colored_feedback set to on.
  warning   Setting-Warning: colored_feedback is not supported in Open-Source version of PyMOL
  prompt   PyMOL>show surface
  prompt   PyMOL>ray 200,150
  info      Ray: render time: 0.01 sec. = 496612.2 frames/hour (0.01 sec. accum.).
  prompt   PyMOL>png /root/nope.png
  error     ScenePNG-Error: error writing "/root/nope.png"! Please check directory...
--- non-destructive replay (client reconnect) ---
replay n = 18 identical: True
--- incremental ---
since(last) n = 0
wait_for got: ['PyMOL>fragment gly', ' Executive: object "gly" created.']
lock_busy_count = 0
stdout after stop is real: True
OK
```

and on the real terminal, correctly *not* swallowed:

```
this is a server log line, must NOT be swallowed
...
stdout restored, this must appear on the real terminal
```

---

## 11. Required changes to other owners' documents

These are reported, not applied — the files belong to other agents.

1. **`docs/spikes/build.md` and `docs/build-and-tooling.md`** — the
   canonical smoke test `pymol.finish_launching(['pymol','-cq'])` and any bridge startup using
   `-c`/`-cq` must not be carried into the bridge. `-c` permanently disables console feedback.
   Keep `-cq` for CI smoke tests only.
2. **`docs/spikes/build.md` §5.1 and §5.3** (this item used to cite an "action item (3)" that
   does not exist in that file) — "must use `pymol2.PyMOL()`, not
   `pymol.finish_launching()`" is half right. It must be **`pymol2.SingletonPyMOL()`**.
   `pymol2.PyMOL()` breaks `pcatch` and silently destroys all Python console output.
3. **`docs/architecture.md`** — the bridge must set
   `no_gui=0, internal_gui=0, internal_feedback=0, external_gui=0` on
   `pymol.invocation.options` *before* `start()`. Setting them afterwards has no effect (options
   are copied into `CPyMOLOptions` at `_cmd._new`).
4. **`docs/architecture.md` / `internal-gui.md`** — the console feature rows should
   record that `_get_feedback()` is a destructive single-consumer read and that scrollback,
   sequence numbers and replay are the bridge's responsibility, not PyMOL's.
5. **`docs/internal-gui.md`** — progress reporting is a separate channel
   (`cmd.get_progress()`), not part of the feedback stream.
6. **Headless feedback capture** — the blocker this spike was written to answer can be
   marked resolved; no C++ change required.
