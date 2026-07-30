# Spike 05 — State change detection for the web-client bridge

Status: **BLOCKER RESOLVED — no new C++ is required for v1.** Polling at 30 Hz costs
**0.25 % of one core** on a 52 k-atom / 11-object scene. Two real problems remain, and neither
is "polling is too slow": (a) **consume-once drains** force a single-owner rule, and (b) **the
main API lock blocks the poller for the entire duration of any long C++ call** (measured: a
`cmd.ray()` froze `cmd.get_names()` for 3.8 s).

All numbers below were produced with
`/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad/venv/bin/python`
(pymol 3.2.0a0, CPython 3.13.3, macOS arm64), headless via `pymol2.PyMOL()`. Scripts are in
`<scratchpad>/events/e1_timing.py` … `e14_final.py`. No repo file other than this document was
touched.

---

## 1. How the Qt GUI detects change today (the real polling model)

There is **no event bus**. `grep -rn "Notify" layer0 layer1 layer2 layer3 layer4 layer5` returns
**0 hits** (re-verified). Every live surface is either a poll or a redraw.

### 1.1 Two timers, that's it

| Timer | File:line | Period | What it does |
|---|---|---|---|
| GL idle timer | `modules/pmg_qt/pymol_gl_widget.py:114-116`, rearmed at `:250` with `self._timer.start(20)` | **50 Hz** (20 ms, single-shot self-rearming); `start(0)` at `:207` after input events | `self.pymol.idle()` then `self.pymol.getRedisplay()`; if either is true → `self.update()` (schedules `paintGL`) |
| Feedback timer | `modules/pmg_qt/pymol_qt_gui.py:391-394` | **2 Hz** (`start(100)` once at startup, then `start(500)` at `:958` after every tick); `start(0)` at `:964` right after a typed command | `update_progress()` + `_get_feedback()` + `get_setting_updates()` |

`update_feedback` (`pymol_qt_gui.py:941-958`) is the whole "state sync" of the external GUI:

```python
def update_feedback(self):
    self.update_progress()                       # cmd.get_progress() -> progress bar
    feedback = self.cmd._get_feedback()          # drains the log ring -> text pane
    ...
    for setting in self.cmd.get_setting_updates() or ():   # drains changed-setting flags
        ...                                                # -> re-checks menu items
    self.feedback_timer.start(500)
```

### 1.2 The object list is NOT polled from Python at all

Nothing in `pmg_qt` calls `cmd.get_names()` on a timer. The object panel is a C++ `Block`:
`struct CExecutive : public Block` with `void draw(CGO*) override` (`layer3/ExecutiveDef.h:54`,
`:99`). It is redrawn from the live `I->Spec` linked list on every `paintGL`, i.e. up to 50 Hz.
**The React client cannot inherit this** — it must synthesise an object-list feed that has never
existed. Same for the wizard panel, the scene bin strip and the internal command line.

### 1.3 The three existing consumers of the consume-once drains

```
modules/pmg_qt/pymol_qt_gui.py:944          self.cmd._get_feedback()
modules/pmg_qt/pymol_qt_gui.py:952          self.cmd.get_setting_updates()          # global
modules/pmg_tk/Setting.py:146               self.cmd.get_setting_updates(sele, state)  # per-object
modules/pmg_tk/skins/normal/__init__.py:489 self.cmd._get_feedback(self.cmd)
```

That is the complete list. Only GUIs drain them, and only one GUI runs at a time — which is
exactly why upstream never noticed the single-consumer constraint.

---

## 2. Measured cost of the polls a web client needs

Scene: `4HHB.pdb` replicated to **52 569 atoms in 11 objects**, cartoon shown.
Median of 200 calls each (`<scratchpad>/events/e1_timing.py`):

```
cmd.get_names()                    median=      1.3 us  p95=      1.3 us
cmd.get_names('objects')           median=      1.2 us
cmd.get_names('all')               median=      1.3 us
cmd.get_names('public_selections') median=      1.0 us
cmd.get_view()                     median=      2.0 us
cmd.get_frame()                    median=      0.2 us
cmd.get_state()                    median=      0.2 us
cmd.count_atoms('sele')            median=    152.5 us   <-- 141-atom selection
cmd.count_atoms('all')             median=    269.2 us
cmd.get_setting_updates()          median=      1.0 us
cmd.get_vis()                      median=      3.1 us
cmd._get_feedback()                median=      0.7 us
cmd.get_progress()                 median=      0.3 us
cmd.get_movie_playing()            median=      0.8 us
cmd.get_scene_list()               median=      0.7 us
cmd.get_wizard()                   median=      0.9 us
--------------------------------------------------------
SUM of medians (full set):        437.4 us  =  0.437 ms
budget @30 Hz = 33 333 us  |  @20 Hz = 50 000 us
p.idle()                           median=      0.7 us
p.getRedisplay()                   median=      0.8 us
cmd.refresh()  (nothing dirty)     median=      1.5 us
```

**`count_atoms` is the only poll that scales with the scene, and it scales badly**
(`<scratchpad>/events/e6_misc.py`):

```
atoms=  52569 objs= 11 | get_names  1.3us | get_view 2.0us | get_vis  3.1us | count_atoms(sele)  172us | count_atoms(all)   279us
atoms= 200718 objs= 42 | get_names  1.8us | get_view 2.0us | get_vis  9.5us | count_atoms(sele) 1100us | count_atoms(all)  1418us
atoms= 501795 objs=105 | get_names  3.0us | get_view 2.0us | get_vis 24.9us | count_atoms(sele) 5902us | count_atoms(all)  6739us
cmd.index('sele') at 500k atoms   = 11 796 us   (60 270 indices)
cmd.get_names('selections')       =      1.2 us  (does not scale)
```

At 500 k atoms `count_atoms('sele')` alone is **5.9 ms**, i.e. 18 % of a 30 Hz budget. It must
not be in the hot tick.

### 2.1 Verdict on rate

Measured steady state of the actual proposed tick (`<scratchpad>/events/e12_design.py`),
300 ticks at 30 Hz on the 52 k-atom scene, snapshot + diff + settings drain, plus a 10 Hz status
thread running concurrently:

```
tick cost median 67.7 us  p95 97.3 us  max 229.6 us
wall 11.00 s, process CPU 0.027 s -> 0.25% of one core
false-positive emissions with nothing happening: 0
```

**30 Hz polling is viable with a ~130× margin. Change counters in C++ are a nice-to-have, not a
prerequisite.** The 0-false-positive result matters as much as the cost: the diff is stable, so
the WebSocket stays silent when PyMOL is idle.

---

## 3. Consume-once behaviour — confirmed, and it is worse than "one consumer"

`SettingGetUpdateList` (`layer1/Setting.cpp:1121-1147`) clears each `changed` flag as it reads it:

```cpp
for (int a = 0; a < cSetting_INIT; ++a) {
  if(I->info[a].changed) {
    I->info[a].changed = false;      // <-- destructive read
    result.push_back(a);
  }
}
```

Measured (`<scratchpad>/events/e2_consume.py`):

```
--- get_setting_updates consume-once ---
after 2 sets: call1 = [155, 279]
             call2 = []

--- two independent 'consumers' interleaved (the failure mode) ---
consumerA saw: [468]  consumerB saw: []
=> EXACTLY ONE CONSUMER: True

--- _get_feedback consume-once ---
call1 = ["PyMOL>print('hello-from-pymol')"]
call2 = []

--- getRedisplay ---
getRedisplay call1=1 call2=0            (reset=True is the default)
getRedisplay(reset=False) twice: 1 1    (non-destructive variant exists)
```

Additional facts that the architecture doc does not currently capture:

1. **The per-object setting drain is a *separate* channel.** Setting a per-object value does not
   show up in the global drain:
   ```
   global drain after object-level set: []
   object drain call1: [155]
   object drain call2: []
   ```
   So the bridge must call `cmd.get_setting_updates(name, state)` for **every object** as well as
   the global one. Cost measured for 31 objects: **21.6 µs total** (`e13_vis.py`) — cheap, do it
   every tick.

2. **`_get_feedback()` returns `None`, not `[]`, when it cannot get the lock**
   (`modules/pymol/internal.py:596-606`, `lock_attempt` = `acquire(blocking=0)`,
   `modules/pymol/locking.py:29-30`). Treating `None` as "no output" is silently correct today
   only because the queue is not drained; treating it as `[]` and *also* clearing local buffers
   would lose lines. Measured directly during a running `ray`: `_get_feedback -> None`.

3. **`get_setting_updates()` returns `[]` on a lock miss** (`modules/pymol/setting.py:440-447`),
   which is indistinguishable from "nothing changed". This is *safe* (nothing was drained, so
   the flags survive to the next tick) but it means a lock miss looks like quiescence. Do not
   build "settle detection" on it.

4. **The feedback queue is unbounded.** `OrthoFeedbackIn` (`layer1/Ortho.cpp:492-499`) pushes into
   a `std::queue<std::string>` with no cap; `OrthoFeedbackOut` (`:502-515`) pops exactly one.
   Measured: 20 000 undrained lines → **+2.98 MB RSS, all 20 000 returned in order**
   (`e8_fb2.py`). If the browser disconnects and the bridge stops draining, PyMOL leaks. The
   bridge must drain unconditionally and buffer on the Python side with its own cap.

5. `OrthoFeedbackIn` is gated on `G->Option->pmgui`. It is true under `pymol2.PyMOL()` (verified:
   `cmd.do("print('X')")` → `["PyMOL>print('X')"]`). But `echo=0` suppresses it entirely, and
   raw Python `print()` only reaches the queue if `pcatch._install()` has redirected `sys.stdout`
   (that is what `pymol_gl_widget.py:105` does). **The bridge must call `pcatch._install()` or it
   will not see plugin/script `print` output.**

6. A **session load fires 798 setting updates** in one drain (`e6_misc.py`) — usable as a
   "resync everything" signal. Scene recall fires a small set (`[23, 152, 254, 396]`).

---

## 4. Is there ANY push mechanism already? Yes — one, and it is unusable as-is

`cmd.set_key` returns `None` headless and only fires from real GUI key events.
`cmd.load_callback(pymol.callback.Callback())` **never fires headless** — 0 hits after `refresh()`,
`idle()` and `ray()` (`e4_push_alt.py`); it is a render-time hook needing a GL pass.
`cmd.log_open()` is **not** a command stream: `cmd.do("turn x, 5")` logged nothing; only calls
made with `log=1` appear (`"/cmd.set('sphere_scale',0.2,'',0)\n"`).

The one real push channel is the **wizard event mask** (`layer1/Wizard.cpp:49-58`):

```
cWizEventPick 1 | Select 2 | Key 4 | Special 8 | Scene 16 | State 32 | Frame 64 | Dirty 128 | View 256 | Position 512
```

`WizardUpdate` (`layer1/Wizard.cpp:101-131`) compares `LastUpdatedFrame` / `LastUpdatedState` /
`LastUpdatedView` and calls back into Python. It is invoked from exactly one place:
`ExecutiveDrawNow` (`layer3/Executive.cpp:11533`). `WizardDoView`/`WizardDoPosition` are also
called from `SceneUpdate` (`layer1/Scene.cpp:4675-4676`) and `WizardDoScene` from
`layer1/Scene.cpp:4812`.

Measured headless with a spy wizard returning `get_event_mask() == 1023`
(`<scratchpad>/events/e3_wizard_push.py`):

```
mutation                | during action | after p.idle() | after cmd.refresh()
------------------------+---------------+----------------+---------------------------
turn x 10               | []            | []             | ['do_view']
zoom chain A            | []            | []             | ['do_position','do_view','do_dirty']
frame(+1)               | []            | []             | ['do_dirty','do_frame:5']
set state               | []            | []             | ['do_scene']
load new object         | []            | []             | ['do_scene']
color red               | []            | -              | ['do_scene']
show / hide spheres     | []            | -              | ['do_scene']
disable / enable        | []            | -              | ['do_scene']
set sphere_scale        | []            | -              | ['do_scene']
scene recall            | []            | -              | ['do_scene','do_dirty']
set_name                | []            | -              | ['do_scene']
cmd.select(...)         | []            | -              | []          <-- MISS
cmd.delete(...)         | []            | -              | []          <-- MISS
cmd.ungroup(...)        | []            | -              | []          <-- MISS
```

Four disqualifying properties, all measured:

1. **It is not a push at all — it is draw-pumped.** `p.idle()` delivers nothing. Only
   `cmd.refresh()` (`layer4/Cmd.cpp:4715-4731` → `SceneInvalidateCopy` + `ExecutiveDrawNow`) or
   `cmd.ray()` deliver events. So you still need a loop; you have merely moved the poll into the
   render path.
2. **The pump is expensive when it does anything.** `cmd.refresh()` on the 52 k-atom scene:
   `median 1.5 µs` when clean, but `median 38 313 µs` (38 ms) after `cmd.color("red","all")`,
   because `SceneUpdate` rebuilds every rep. Pumping at 30 Hz during interactive editing forces a
   full rep rebuild 30×/s.
3. **Object-list deletes and all selection changes are missed** (see table).
4. **Fatal: there is exactly one wizard stack and the user owns it.** Verified:
   ```
   spy alone ->  ['spy.do_view'] | get_wizard: Spy
   after cmd.wizard('measurement'), get_wizard: Measurement
   stack: ['Spy', 'Measurement']
   spy events while user wizard active: []
   ```
   `WizardGet` returns the *top* of the stack, so the moment the user opens Mutagenesis or
   Measurement the bridge goes deaf. Default mask is `pick+select` only
   (`layer1/Wizard.cpp:218-227`), so real wizards would not re-emit them either.

**Conclusion: do not build the bridge on wizards.** They stay reserved for the wizard-parity
feature itself (WP for `wizards.md`), where the bridge must *proxy* the user's wizard.

---

## 5. The real hazard: the API lock, not the poll rate

`cmd.get_names` → `CmdGetNames` → `APIEnter(G)` (`layer4/Cmd.cpp:2377-2387`), the **blocking**
API lock. A poller thread running while the main thread ran `cmd.ray(300,220)` on the 52 k-atom
scene (`<scratchpad>/events/e10_lockfree.py`, ray took ~4.3 s):

```
probe                    block ms  ray done  value/err
get_progress                  0.1  False     -1.0
_get_feedback                 0.0  False     None
get_setting_updates           0.0  False     []
get_names                  3808.8  True      ['base', 'c1', ...]   <-- BLOCKED 3.8 s
get_view                      0.1  True      ...
```

And in the end-to-end 30 Hz poller test (`e9_loop.py`) that single blocked tick shows up as:

```
ran 5.90s, 47 ticks (target 177), lock-miss=0
tick cost median 58.6 us  p95 182.0 us  max 4 390 701.2 us      <-- 4.39 seconds
schedule lateness median 3.81 ms  p95 5.02 ms  max 5.03 ms      (ray took 4419 ms)
```

So there are **two classes** of query and the bridge must keep them on separate channels:

| Channel | Lock | Works during a long op? | Members |
|---|---|---|---|
| **status** | `lock_api_status` / `lock_attempt` (non-blocking) | **yes** | `cmd.get_progress()` (`modules/pymol/monitoring.py:5-7`), `cmd._get_feedback()`, `cmd.get_setting_updates()` |
| **state** | `APIEnter` (blocking) | no — serialises behind the command | everything else: `get_names`, `get_view`, `get_vis`, `count_atoms`, … |

`cmd.get_progress()` genuinely tracks long operations. Sampled at 20 Hz from a second thread
during a 4.30 s ray (`e11_progress.py`): 63 of 81 samples were ≥ 0, values
`0.25 → 0.386 → 0.440 → 0.495 → 0.577 → 0.734 → …`. During a 5.20 s surface build via
`cmd.refresh()`: 95 of 98 samples ≥ 0. **This is the mechanism for the web client's progress bar
and it is the only thing that reports liveness while PyMOL is busy.**

---

## 6. What the poll *cannot* see (measured gaps)

`<scratchpad>/events/e12_design.py` / `e13_vis.py` / `e14_final.py`:

1. **Per-atom representation state is invisible.** `cmd.get_vis()` reports the *object-level*
   visRep only. Proof:
   ```
   cartoon only      : [1, [], [5], 5]
   + spheres on CA   : [1, [], [5], 5]   changed: False   (574 atoms have rep spheres)
   + sticks on ALL   : [1, [], [0, 5], 5] changed: True
   ```
   `show spheres, m and name CA` is undetectable by any cheap poll. (PyMOL's own object panel
   does not display per-rep state either, so this is not a parity regression — but any React
   "reps" indicator beyond upstream's would need `cmd.count_atoms("x and rep spheres")` per rep,
   which is `count_atoms`-priced.)
2. **Colour changes are invisible.** `cmd.color("red", sel)` changes no polled field.
   `cmd.get_object_color_index(name)` (0.8 µs) catches only the *object* colour, not per-atom.
3. **Coordinate / `alter` / `alter_state` changes are invisible.**
4. **Group membership** needs an extra query: `cmd.get_names("objects", selection="grp")`
   (58.9 µs) — the group object itself survives `ungroup`, so the names tuple does not change.
5. `cmd.set_name("base","BASE")` is a **no-op** because `ignore_case` is `on` by default —
   an easy false "missed event" when writing tests.

These four gaps are exactly the ones the **command-echo channel** covers (§7.3): the client
issued the command, so it already knows to re-pull geometry for that selection.

### Positive control — what the poll *does* catch, within one tick

```
turn x 10                    -> ['view']
zoom chain A                 -> ['view']
create newobj                -> ['names','enabled','view','vis']
delete newobj                -> ['names','enabled','vis']
select sele                  -> ['names','enabled','vis']
deselect                     -> ['enabled']
delete sele                  -> ['names','vis']
disable base / enable base   -> ['enabled']
set sphere_scale             -> ['settings(1)']
mset 1 x20                   -> ['settings(2)']
frame 7                      -> ['frame','settings(2)']
scene store SZ               -> ['scenes','settings(2)']
scene recall SZ              -> ['settings(4)']
group g1                     -> ['names','enabled','vis']
```

Movie playback **does** advance headless under `p.idle()`: 1 s of `idle()+refresh()` at
`movie_fps 30` produced 28 distinct frames over 164 ticks (`e6_misc.py`). So the tick must call
`p.idle()` for `mplay` to work at all, and `frame` is caught by the diff.

---

## 7. The design

### 7.1 Process/thread shape

```
 browser ──WebSocket──┐
                      │
        ┌─────────────▼──────────────────────────────────┐
        │ PyMOL process (single pymol2.PyMOL instance)   │
        │                                                │
        │  MAIN THREAD  ("PyMOL thread") — owns API lock │
        │    while True:                                 │
        │      drain command inbox (from WS)             │
        │      execute commands                          │
        │      p.idle()                                  │
        │      tick()  -> snapshot + diff + drains       │
        │      sleep to 33 ms cadence                    │
        │                                                │
        │  STATUS THREAD (10 Hz) — never takes API lock  │
        │    cmd.get_progress()                          │
        │    cmd._get_feedback()                         │
        │    cmd.get_setting_updates()                   │
        │                                                │
        │  WS I/O THREAD (asyncio loop)                  │
        └────────────────────────────────────────────────┘
```

Rules, each forced by a measurement above:

* **One PyMOL thread.** All `APIEnter` calls (i.e. all of §7.2) happen on the thread that also
  executes commands, so a poll can never contend with a command. Contention is not a deadlock but
  a 4-second stall (§5).
* **The status thread must only ever call the three non-blocking functions.** Adding a
  `cmd.get_names()` to it re-introduces the stall.
* **The bridge is the sole owner of the three drains.** `get_setting_updates()` (global **and**
  per-object), `_get_feedback()` and `getRedisplay()` are destructive. No plugin, no
  `pymol.rpc`, no `pymolhttpd` may run alongside. `pcatch._install()` must be called at startup.
  Nothing else in the process may call them — enforce with a lint rule over `webclient/`.
* **`_get_feedback() is None` means "locked, retry"**, not "empty".
* Never let the feedback queue go undrained (unbounded, §3.4).

### 7.2 The tick (30 Hz, main thread)

Snapshot fields, all measured cheap and all confirmed to change on the mutations in §6:

```python
def snapshot():
    return {
      "names":    tuple(cmd.get_names("all", enabled_only=0)),   #   1.3 us
      "enabled":  tuple(cmd.get_names("all", enabled_only=1)),   #   1.3 us
      "groups":   tuple(cmd.get_names("group_objects")),         #   1.3 us
      "view":     cmd.get_view(),                                #   2.0 us
      "frame":    cmd.get_frame(),                               #   0.2 us
      "state":    cmd.get_state(),                               #   0.2 us
      "scenes":   tuple(cmd.get_scene_list()),                   #   0.7 us
      "vis":      canon(cmd.get_vis()),                          #   3.1 us
      "movie":    cmd.get_movie_playing(),                       #   0.8 us
      "wizard":   wizard_ident(cmd.get_wizard()),                #   0.9 us
    }
```

Drains, same tick:

```python
su_global = cmd.get_setting_updates()                # 1.0 us
su_object = {n: cmd.get_setting_updates(n, 0)        # 21.6 us for 31 objects
             for n in snap["names"]}
```

Total measured: **median 67.7 µs, p95 97.3 µs** per tick. Emit a WebSocket message only when the
diff is non-empty; steady state emits **nothing** (0 false positives over 300 ticks).

Cadence: **30 Hz while the browser tab is focused, 4 Hz when hidden** (`document.hidden` → client
tells the bridge). Do **not** go above 30 Hz: it buys nothing, because the camera is driven from
the browser (the client already knows its own view) and everything else is user-paced.

Explicitly **not** in the tick:
* `cmd.count_atoms(...)` — 5.9 ms at 500 k atoms. Selection *atom counts* are a **debounced
  request** (client asks after the `names`/`enabled` diff settles for ~150 ms) or ride on the
  command-echo channel.
* `cmd.get_names("objects", selection=grp)` per group (58.9 µs each) — only re-query when
  `groups` or `names` changed.
* `cmd.refresh()` — see §7.4.

### 7.3 The command-echo channel (covers the §6 gaps)

Every command reaches PyMOL through the bridge (single browser client, no Qt GUI, no second
input path). So the bridge wraps command execution and emits, alongside the result:

```
{ "cmd": "color", "args": ["red", "chain A"], "invalidates": ["geometry:chain A", "color"] }
```

A small static table maps command name → invalidation classes
(`color/set_color → color`, `show/hide → reps`, `alter/alter_state/load/create/remove →
geometry`, `sculpt_activate → coords`, …). This is the mechanism that catches per-atom colour,
per-atom reps, `alter`, and coordinate edits — none of which any poll can see.

The one leak: a `.pml` script or Python block run through `cmd.do` expands to many mutations
behind one echo. Mitigation, measured: after any `cmd.do`/`run`/`@script`, emit a
**`resync: full`** invalidation rather than trying to be clever. `getRedisplay()` is a usable
cheap gate here — measured true for turn/color/show/hide/select/deselect/create/delete/set/
disable/enable/frame/scene-store, false for pure reads like `get_view()` (but note it is *also*
set by `count_atoms`, so it is a hint, not an oracle).

### 7.4 `cmd.refresh()` — pump it, but lazily

`cmd.refresh()` is what makes PyMOL actually rebuild reps (and what the geometry-extraction path
needs). Measured on the 52 k-atom scene:

* nothing dirty → **1.5 µs** (free, call it every tick)
* after `cmd.color("red","all")` → **38 313 µs** (38 ms)
* full-surface build → **5.20 s**

So: call `cmd.refresh()` once per tick (it is free when clean), but **treat it as the long-op
boundary** — when the tick duration exceeds ~50 ms, the status thread is what keeps the UI alive
(`get_progress()` returns real fractions throughout, §5).

### 7.5 Message shape

```
S→C  state.delta   { seq, changed: {names?, enabled?, groups?, view?, frame?, state?,
                                    scenes?, vis?, movie?, wizard?},
                     settings: {global:[idx…], perObject:{name:[idx…]}} }
S→C  state.resync  { seq, full snapshot }        # session load, cmd.do, client reconnect
S→C  log.append    { lines:[…] }                 # 10 Hz status thread
S→C  progress      { value }                     # 10 Hz status thread, -1 == idle
C→S  poll.rate     { hz }                        # 30 when focused, 4 when hidden
```

`seq` is a monotonic tick counter; on reconnect the client sends its last `seq`, and since the
drains are destructive and unreplayable the bridge always answers with `state.resync`.

---

## 8. What must be added in C++ (v2, optional — none of it blocks v1)

Every item below is an optimisation or a correctness improvement, not a prerequisite. Ranked by
value/cost. **All of these touch upstream files and are owned by whoever owns `layer1/`,
`layer3/`, `layer4/` — reported here, not applied.**

### 8.1 Non-destructive setting generation counter (highest value, ~4 lines)

The consume-once drain is the only *correctness* problem in the design; everything else is
performance. `SettingRec::setChanged()` (`layer1/Setting.h:67-70`) is the single write chokepoint
for every setting mutation in the program:

```cpp
void setChanged() {
  defined = true;
  changed = true;
}
```

Add a process-global monotonic counter there and expose it as `cmd.get_setting_generation()`
(`layer4/Cmd.cpp`, `APIEnterBlocked`). The bridge then polls a `uint64` instead of draining, and
`get_setting_updates()` is left alone for plugins/Qt. Removes the single-owner rule for settings
and makes reconnect replayable. (Note: it does *not* tell you *which* setting changed — keep the
drain as the detail channel, or add a parallel `uint64 generation` per `SettingRec`.)

### 8.2 `ExecutiveNamesVersion` (~3 lines)

`ExecutiveInvalidatePanelList` (`layer3/Executive.cpp:1513-1518`) is already the chokepoint for
"the object panel changed". Its 11 call sites are precisely the interesting ones:

```
1622  ExecutiveInvalidateGroups        3238  ExecutiveOrder
1684  ExecutiveUpdateGroups            5297  ExecutiveSetNamedEntries
1876  ExecutiveScrollTo               14455  ExecutivePurgeSpec        (delete)
14603 ExecutiveDeleteStates           14618  ExecutiveReAddSpec
14856 ExecutiveManageObject (create)  14927  ExecutiveManageSelection  (select)
17328 ExecutiveSetOrderOf
```

Add `uint64_t NamesVersion{1};` to `struct CExecutive` (`layer3/ExecutiveDef.h:54`) and
`++I->NamesVersion;` inside `ExecutiveInvalidatePanelList`. Two sites do **not** route through it
and need their own bump: `ExecutiveSpecEnable` (`layer3/Executive.cpp:15376`, enable/disable) and
`ExecutiveSetName` (`:3580`, rename). Saves ~4 µs/tick — marginal, but it makes the "did the
object list change" question O(1) instead of "allocate two Python lists and compare".

### 8.3 `ReprVersion` / `ColorVersion` (real new capability)

This is the only item that gives the client something it cannot get today. Bump a counter in
`ExecutiveInvalidateRep` (`layer3/Executive.cpp:14001`) keyed by invalidation class
(`cRepInvColor`, `cRepInvVisib`, `cRepInvRep`, `cRepInvCoord`). That closes the §6 gaps
(per-atom colour, per-atom reps, `alter`, coordinate edits) without relying on the command-echo
channel, which in turn makes the bridge robust to `.pml` scripts and to a future second client.

### 8.4 Explicitly NOT recommended

* **Do not add a Notify/observer bus.** The measured poll cost (67.7 µs at 30 Hz = 0.25 % core)
  does not justify threading an event system through five layers, and a C++→Python callback has
  to take the GIL anyway — which is exactly the `WizardCallPython` pattern that already exists
  and already has the re-entrancy hazard (`WizardUpdate` → `SceneUpdate` → `WizardDoView`,
  `layer3/Executive.cpp:11533-11534`; the wizard header itself warns
  `event_mask_dirty = 128 # anything changed (BEWARE FEEDBACK!)`,
  `modules/pymol/wizard/__init__.py:13`).
* **Do not bound the feedback queue in C++** to fix §3.4 — bound it in the bridge instead, so the
  fix does not have to ship in a rebuilt `_cmd.so`.

---

## 9. Consequences for other owners (reported, not applied)

1. `docs/webclient/01-architecture.md` — the bridge must be **single-threaded for state queries**
   with a **separate non-blocking status thread**. A "poller thread + command thread" design
   stalls for the full duration of `ray`/surface builds (measured 3.8 s and 5.2 s).
2. `01-architecture.md` — the bridge is the **exclusive owner** of `get_setting_updates()`
   (global *and* per-object), `_get_feedback()` and `getRedisplay(reset=True)`. Any design that
   also runs `pymol.rpc`, `pymolhttpd`, or a Qt GUI in the same process is broken. Add a lint rule.
3. `01-architecture.md` / `wizards.md` — the wizard event mask **cannot** be used as the bridge's
   change feed (single stack, user-owned, draw-pumped, misses delete/select). Wizards remain a
   proxied feature, not infrastructure.
4. `00-parity-inventory.md` — the object panel, wizard panel and scene bin have **no Python data
   feed today** (they are C++ `Block::draw` surfaces). Those rows need explicit "new bridge
   endpoint required" flags, not "wire up existing API".
5. Whoever owns `internal-gui.md` / geometry extraction: `cmd.get_vis()` is object-level only —
   per-atom rep state must come from the command-echo channel or from §8.3.
6. Build/bootstrap owner: `pcatch._install()` must be called by the bridge at startup, mirroring
   `modules/pmg_qt/pymol_gl_widget.py:105`, or script `print()` output never reaches the client.

---

## 10. Reproduction

```
cd <scratchpad>/events
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e1_timing.py       # §2 poll costs
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e2_consume.py      # §3 consume-once
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e3_wizard_push.py  # §4 wizard events + refresh cost
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e4_push_alt.py     # §4 load_callback/set_key/log/stack
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e5_dirtybit.py     # getRedisplay coverage
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e6_misc.py         # §2 scaling, movie, session
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e8_fb2.py          # §3.4 unbounded queue
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e9_loop.py         # §5 30 Hz poller vs ray
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e10_lockfree.py    # §5 blocking vs non-blocking
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e11_progress.py    # §5 progress during long ops
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e12_design.py      # §7 prototype + coverage
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e13_vis.py         # §6 get_vis / per-object drain
PYTHONUNBUFFERED=1 <scratchpad>/venv/bin/python e14_final.py       # §6 rename/groups/reps
```

`<scratchpad>` =
`/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad`
