# Movies, Scenes, States/Frames, Sequence Viewer

Map of four coupled PyMOL subsystems. The engine (`packages/engine/`, C++ + Python `cmd`) is
unmodified upstream and is reached over the Python bridge. Every claim below is anchored to a
`file:line` that was read.

**Where the port stands.** Movie panel and transport:
`apps/web/src/features/movie/` (`MovieTimeline`, `TransportBar`, `MovieEditors`, `ExportDialog`,
`msetParser.ts`, `timeline.ts`, `mvprg.ts`) over `packages/bridge/tenmol_bridge/panels/movie.py`
and `packages/protocol/src/topics/movie{,_panel}.ts`. Scenes: `apps/web/src/features/scenes/`
over `packages/protocol/src/topics/scenes.ts`. Sequence viewer:
`apps/web/src/features/seqview/` over `packages/bridge/tenmol_bridge/panels/seqview.py`.
The clock stays on the backend (§0), and the frame stream arrives on
`packages/protocol/src/topics/frame.ts`.

---

## 0. Executive summary of the area

Four coupled subsystems live here:

1. **States vs. frames.** Objects have *states* (coordinate sets). The viewer has *frames*.
   By default 1 frame = 1 state; `mset` defines an arbitrary frame→state map
   (`packages/engine/modules/pymol/moving.py:691`, `packages/engine/layer1/Movie.cpp:979` `MovieFrameToIndex`).
2. **Movies.** Per-frame command strings (`mdo`/`mappend`), per-frame *key frames*
   (`mview`, `CViewElem`) for camera and per-object matrices, plus playback
   (`mplay`/`mstop`/`mtoggle`) and export (`mpng`, `movie.produce`).
3. **Scenes.** Named snapshots of view + colors + reps + enabled-state + frame + message
   + a PNG thumbnail (`packages/engine/layer3/MovieScene.h:73`, `packages/engine/layer3/MovieScene.cpp:173`).
4. **Sequence viewer ("Seeker").** An in-viewport text grid built in C++
   (`packages/engine/layer3/Seeker.cpp:969` `SeekerUpdate`) and drawn as GL text
   (`packages/engine/layer1/Seq.cpp:259` `CSeq::draw`). Selection interaction mutates the *active selection*
   via generated `cmd.select(...)` strings (`packages/engine/layer3/Seeker.cpp:169`, `:70`).

Two of these (movie panel, sequence viewer) are **Ortho blocks drawn inside the GL viewport**
upstream (`packages/engine/layer1/Movie.cpp:1741`, `packages/engine/layer1/Seq.cpp:259`,
`packages/engine/layer1/Control.cpp:536`), plus **scene buttons** drawn as an overlay on the
Scene block (`packages/engine/layer1/Scene.cpp:2885` `SceneDrawButtons`, gated by
`scene_buttons`, `packages/engine/layer1/Scene.cpp:3456`). All three are React components in
the port and are never drawn by the engine.

### Why parts of this area are server-rendered raster, not geometry

The molecular scene reaches the browser as geometry, but four features here produce
*server-rendered raster images*:

- `cmd.ray` → `_cmd.render` (`packages/engine/modules/pymol/viewing.py:1581`) writes into `G->Scene->Image`.
- `cmd.draw` → `_cmd.draw` needs a live GL context (`packages/engine/modules/pymol/viewing.py:1652`,
  wrapped in `_self._call_with_opengl_context` at `:1660`).
- `cmd.mpng` / `movie.produce` render every frame to PNG on disk
  (`packages/engine/modules/pymol/moving.py:366`, `packages/engine/layer1/Movie.cpp:626` `MovieModalPNG`,
  `packages/engine/modules/pymol/movie.py:846`).
- Scene **thumbnails** come from `SceneDeferImage` into a 220×124 PNG buffer
  (`packages/engine/layer3/MovieScene.cpp:225-233`, dims at `packages/engine/layer3/MovieScene.h:97-99`).

None of those can be produced client-side, so the bridge owns an offscreen GL context
(`packages/bridge/tenmol_bridge/glcontext/` — CGL, EGL, WGL) and streams encoded bytes
(`packages/bridge/tenmol_bridge/render/encode.py`, `render/framestream.py`). `cmd.draw`
documents that it "does not work when running in the command-line only mode"
(`packages/engine/modules/pymol/viewing.py:1630-1632`), which is why a context-less bridge
falls back to `ray`.

**Movie playback is driven by the backend idle loop**
(`packages/engine/layer1/Scene.cpp:2432` `SceneIdle`, frame pacing at `:2453-2480`, rock at `:2477-2484`).
The backend stays the single clock and pushes frame-change events; the browser never runs its
own playback timer, which is what keeps the two from double-timing.

---

## 1. Frames & states — exact semantics

### 1.1 Frame/state queries

| cmd | source | returns |
|---|---|---|
| `cmd.get_frame()` | `packages/engine/modules/pymol/moving.py:984` | 1-based current frame; **no lock taken** |
| `cmd.get_state()` | `packages/engine/modules/pymol/moving.py:958` | 1-based current state; **no lock taken** |
| `cmd.count_frames()` | `packages/engine/modules/pymol/querying.py:759` | frames defined for the movie |
| `cmd.get_movie_length(images=-1)` | `packages/engine/modules/pymol/querying.py:730` | frames *explicitly* defined by `mset`; negative internal value is folded per `images` arg (`:746-753`) |
| `cmd.count_states(selection)` | `packages/engine/modules/pymol/querying.py:703` | states in selection |
| `cmd.get_movie_playing()` | `packages/engine/modules/pymol/moving.py:64` | bool |
| `cmd.get_movie_locked()` | `packages/engine/modules/pymol/querying.py:814` | bool (movie commands suppressed) |

`MoviePlaying()` returns true also while movie commands are being evaluated
(`packages/engine/layer1/Movie.cpp:540-551`), and returns false when `I->Locked`.

### 1.2 `SceneSetFrame(G, mode, frame)` — the whole navigation vocabulary

`packages/engine/layer1/Scene.cpp:2121-2184`. Modes:

| mode | meaning | Python entry |
|---|---|---|
| -1 | movie/frame override — go to this **state** absolutely | — |
| 0 | absolute frame | `cmd.set_frame(frame, 0)` (`packages/engine/modules/pymol/moving.py:898`) |
| 1 | relative frame | used internally after `mview` (`packages/engine/layer1/Movie.cpp:1372`) |
| 2 | end | — |
| 3 | middle + auto movie command | `cmd.middle()` (`packages/engine/modules/pymol/moving.py:934`) |
| 4 | absolute + auto movie command | `cmd.rewind()` = `set_frame(4,0)` (`packages/engine/modules/pymol/moving.py:874`) |
| 5 | relative + auto movie command | `cmd.forward()` = `(5,+1)` (`:819`), `cmd.backward()` = `(5,-1)` (`:846`) |
| 6 | end + auto movie command | `cmd.ending()` (`packages/engine/modules/pymol/moving.py:911`) |
| 7 | absolute + **forced** movie command | scrollbar drag (`packages/engine/layer1/Movie.cpp:1535`, `:1783`) |
| 8 | relative + forced movie command | — |
| 9 | end + forced movie command | — |
| 10 | seek forward to the frame carrying the current scene | `MovieSeekScene` (`packages/engine/layer1/Movie.cpp:1008`), used by scene recall while playing (`packages/engine/layer3/MovieScene.cpp:408-409`) |

`cmd.frame(n, trigger=-1, scene=0)` is a separate entry (`packages/engine/modules/pymol/moving.py:460`)
calling `_cmd.frame(COb, n-1, trigger)`.

Side effects of a frame change (`packages/engine/layer1/Scene.cpp:2185-2210`): clamp to `[0, NFrame)`,
compute `newState = MovieFrameToIndex(...)`, at frame 0 recall the `mmatrix` matrix and
abort any running animation, set settings `frame` and `state`, invalidate selection
indicator CGOs and picking, optionally run the frame's movie command, and set
`MovieFrameFlag` if `cache_frames`.

### 1.3 Playback loop

`SceneIdle` (`packages/engine/layer1/Scene.cpp:2432`):
- FPS from `movie_fps`; `fps <= 0` → use `movie_delay` ms; `fps < 0` → full speed
  (`:2453-2464`; same logic duplicated in `SceneGetFPS` `packages/engine/layer1/Scene.cpp:342`).
- Adaptive `LastFrameAdjust` smoothing (`:2465-2475`).
- At last frame: if `movie_loop` → `SceneSetFrame(G,7,0)`, else `MoviePlay(G,cMovieStop)`
  (`:2485-2492`).
- If not playing but `ControlRocking(G)` → `SceneUpdateCameraRock` every `rock_delay` ms
  (`:2477-2484`).

`MoviePlay` (`packages/engine/layer1/Movie.cpp:555`): `cMovieToggle=-1`, `cMovieStop=0`, `cMoviePlay=1`
(`packages/engine/layer1/Movie.h:118-120`). When not looping and already at the last frame, play/toggle
first rewinds via `SceneSetFrame(G,7,0)` (`:561-567`, `:573-579`).

---

## 2. `mset` — the frame↔state program

`cmd.mset(specification, frame=1, freeze=0)` — `packages/engine/modules/pymol/moving.py:691`.
The *entire mini-language is parsed in Python* (`:733-764`) then handed to
`_cmd.mset(space-separated 0-based state list, start-1, freeze)`:

- bare integer `N` → one frame showing state N.
- `xN` → repeat previous state N times total (`:743-751`); if no previous, uses current state.
- `-N` → ramp from previous state to N inclusive, direction auto (`:752-760`).
- whitespace normalized, `x`/`-` split off adjacent tokens (`:734-739`).

Examples from the docstring (`:709-722`): `mset 1`, `mset 1 x10`,
`mset 1 x30 1 -15 15 x30 15 -1`.

`cmd.madd` (`packages/engine/modules/pymol/moving.py:677`) is literally `mset(..., frame, freeze)` — it
appends using the same syntax. C side: `MovieSet` / `MovieAppendSequence`
(`packages/engine/layer1/Movie.cpp:877`, `:890`). Redefining the movie clears existing `mdo` commands
(documented at `packages/engine/modules/pymol/moving.py:307-308`, `:349-351`).

**Frame → state resolution**: `MovieFrameToIndex` (`packages/engine/layer1/Movie.cpp:979`) — a per-frame
`ViewElem[frame].state_flag` (set by `mview store, state=…`) *overrides* the `Sequence[]`
map; otherwise `Sequence[frame]`; if no movie, frame == state.

---

## 3. Movie commands (`mdo` / `mappend`)

- `cmd.mdo(frame, command)` → `_cmd.mdo(COb, frame-1, command, 0)` — replaces
  (`packages/engine/modules/pymol/moving.py:274`, C: `MovieSetCommand` `packages/engine/layer1/Movie.cpp:1074`).
- `cmd.mappend(frame, command)` → `_cmd.mdo(COb, frame-1, ";"+command, 1)` — appends
  (`packages/engine/modules/pymol/moving.py:323`, C: `MovieAppendCommand` `packages/engine/layer1/Movie.cpp:1378`).
- `cmd.mdump()` prints all defined commands to the feedback stream, format
  `"%5d: %s\n"` (`packages/engine/modules/pymol/moving.py:81`, C: `MovieDump` `packages/engine/layer1/Movie.cpp:378-403`).
  **There is no structured getter** — see §12 gaps.
- Execution: `MovieDoFrameCommand` (`packages/engine/layer1/Movie.cpp:1045`) — at frame 0 recall
  `mmatrix`; if not locked, `PParse` the command string, then if the frame carries a
  `scene_flag` and the scene differs from `scene_current_name`, `MovieSceneRecall(...)`
  with view=false/frame=false (`:1058-1065`), then `SceneFromViewElem`.

`cmd.mmatrix(action)` with `clear|store|recall|check` → `_cmd.mmatrix(0..3)`
(`packages/engine/modules/pymol/moving.py:772-816`; C `MovieMatrix` `packages/engine/layer1/Movie.cpp:589`,
constants `packages/engine/layer1/Movie.h:161-164`). Docstring warns not to mix with `mview`.

`cmd.mclear()` clears the cached frame images (`packages/engine/modules/pymol/moving.py:436`;
C `MovieClearImages` `packages/engine/layer1/Movie.cpp:1432`).

---

## 4. Key frames — `mview` and `CViewElem`

### 4.1 Python surface

`cmd.mview(action='store', first=0, last=0, power=0.0, bias=-1.0, simple=-1, linear=0.0,
object='', wrap=-1, hand=0, window=5, cycles=1, scene='', cut=0.5, quiet=1, auto=-1,
state=0, freeze=0)` — `packages/engine/modules/pymol/moving.py:160`.

Actions (`packages/engine/modules/pymol/moving.py:145-156`, mirrored in `packages/engine/layer1/MViewAction.h:3-14`):

| name | int | C behavior |
|---|---|---|
| `store` | 0 | `packages/engine/layer1/Movie.cpp:1155-1196` — writes camera/object matrix into frame(s), sets `specification_level=2`, optional `state`, `power`, `bias`, `scene_name` |
| `clear` | 1 | `:1197-1211` — zeroes the `CViewElem` in the range |
| `interpolate` | 2 | `:1212-1343` — fills only *unspecified* gaps between key frames |
| `reinterpolate` | 3 | `:1212-1343` — recomputes all in-between frames |
| `smooth` | 4 | `:1129-1152` — `ViewElemSmooth` × `cycles` with `window`; auto-reinterpolates if `movie_auto_interpolate` |
| `reset` | 5 | `:1344-1349` — reallocates the whole `ViewElem` VLA (drops everything) |
| `uninterpolate` | 6 | `:1350-1366` — deletes frames whose `specification_level < 2` |
| `toggle` | 7 | `:1105-1110` — store if not a key frame, else clear |
| `toggle_interp` | 8 | `:1111-1127` — flips between reinterpolate and uninterpolate |
| `purge` | 9 | (object motions; menu `obj_motion` uses it, `packages/engine/modules/pymol/menu.py:136`) |

Python-side pre/post logic worth cloning verbatim:
- negative `first`/`last` are counted from `count_frames()` (`packages/engine/modules/pymol/moving.py:214-219`).
- `scene='auto'` or `None` → current `scene_current_name`; a non-empty `scene` triggers
  `scene(scene,"recall",animate=0,frame=0)` **before** the store (`:221-225`).
- args are 0-based on the wire: `first-1`, `last-1`, `state-1` (`:228-232`).
- auto-reinterpolate: unless `freeze`, and if `auto>0` or (`auto<0` and
  `movie_auto_interpolate`), actions store/clear/toggle are followed by a second
  `_cmd.mview(action=3, first=-1, last=-1, …)` (`:233-241`).

### 4.2 `CViewElem` — what a key frame holds

`packages/engine/layer1/View.h:24-63`: 4×4 `matrix` (+flag), `pre[3]`, `post[3]`, `front`/`back` clip
(+`clip_flag`), `ortho` (+flag), `state` (+`state_flag`), `view_mode` (0 relative /
1 absolute), `specification_level` (0 none, 1 interpolated, 2 key frame),
`timing` (+flag), `scene_name` lexicon key (+`scene_flag`), `power` (+flag),
`bias` (+flag).

Interpolation entry point: `ViewElemInterpolate(G, first, last, power, bias, simple,
linearity, hand, cut)` (`packages/engine/layer1/View.h:93`). Smoothing: `ViewElemSmooth(first,last,window,loop)`
(`packages/engine/layer1/View.h:92`).

### 4.3 Frame-range editing (`mmove` / `mcopy` / `mdelete` / `minsert`)

All four funnel into `_cmd.mmodify(COb, action, index, count, target, object, freeze, quiet)`:

| cmd | action | source |
|---|---|---|
| `mdelete(count=-1, frame=0, …)` | -1 | `packages/engine/modules/pymol/moving.py:591` |
| `minsert(count, frame=0, …)` | 1 | `packages/engine/modules/pymol/moving.py:640` |
| `mmove(target, source=0, count=-1, …)` | 2 | `packages/engine/modules/pymol/moving.py:493` |
| `mcopy(target, source=0, count=-1, …)` | 3 | `packages/engine/modules/pymol/moving.py:545` |

Semantics: `0` means "current frame" (`get_frame()-1`), negative counts back from the end
and clamps so `frame+count <= cur_len` (`:520-535`, `:621-630`). `count<0` in `mdelete`
means "to the end" (`:629-630`). C side: `MovieViewModify` (`packages/engine/layer1/Movie.cpp:89`),
enum `ViewElemAction {Delete=-1, Insert=1, Move=2, Copy=3}` (`packages/engine/layer1/View.h:100-106`).
When not frozen/localized it calls `ExecutiveMotionExtend` (`packages/engine/layer1/Movie.cpp:157-159`).

---

## 5. The Movie Panel (in-viewport upstream)

`CMovie` is an Ortho `Block` (`packages/engine/layer1/Movie.h:52`). Height:
`MovieGetPanelHeight` (`packages/engine/layer1/Movie.cpp:1701`) = `movie_panel_row_height` ×
`ExecutiveCountMotions(G)`, or a single row when `presentation` is on (`:1716-1721`);
zero when `movie_panel==0` or there is nothing to show (`:1703-1711`).

Rows come from `ExecutiveMotionDraw` (`packages/engine/layer3/Executive.cpp:697`): one row for the global
camera (`cExecAll`, drawn by `MovieDrawViewElem` → `ViewElemDraw(..., "camera", …)`,
`packages/engine/layer1/Movie.cpp:1728-1734`) and one row per object that has motions
(`ObjectDrawViewElem`, `packages/engine/layer3/Executive.cpp:727`). Row count = `ExecutiveCountMotions`
(`packages/engine/layer3/Executive.cpp:664`), which falls back to 1 when `SceneGetNFrame(G) > 1` (`:684-685`).

Per-frame cell painting (`packages/engine/layer1/View.cpp:158-260`): color by `specification_level` —
level 1 (interpolated) draws a thin center bar (`bar_color {0.3,0.3,0.6}` with
`key_color` top edge and `bot_color` bottom edge, `:189-232`); level 2 (key frame) draws a
full-height block in `key_color {0.4,0.4,0.8}` (`:233-248`). `top_color {0.6,0.6,1.0}` and
`bot_color {0.2,0.2,0.4}` are the remaining palette entries (`:172-175`).
X↔frame mapping: `ViewElemXtoFrame(rect, frames, x, nearest)` (`packages/engine/layer1/View.h:98`,
wrapper `MovieXtoFrame` `packages/engine/layer1/Movie.cpp:72`).

A horizontal `ScrollBar` doubles as the frame slider (`packages/engine/layer1/Movie.cpp:1775-1793`);
dragging it issues `SceneSetFrame(G, 7, value)` (`:1781-1784`, and on click `:1535`).
When there are no `ViewElem`s at all the row is labelled `"states"`
(`packages/engine/layer1/Movie.cpp:1842-1844`).

### 5.1 Complete mouse grammar of the panel

`CMovie::click` (`packages/engine/layer1/Movie.cpp:1488`), `::drag` (`:1574`), `::release` (`:1609`).
`tmpRect.right -= LabelIndent` where `LabelIndent = 8*8 dip` unless `presentation`
(`packages/engine/layer1/Movie.cpp:1864-1868`).

| input | drag mode | released action |
|---|---|---|
| Right-drag | `cMovieDragModeMoveKey` | `cmd.mmove(cur+1, start+1, 1, object=…)` (`:1639`) |
| Shift + Right-drag | `cMovieDragModeCopyKey` | `cmd.mcopy(cur+1, start+1, 1, object=…)` (`:1653`) |
| Ctrl+Shift + Right | as above, but `DragColumn=true` → `object=''` i.e. all rows (`:1501-1502`, `:1620-1621`) | |
| Right-click past the end of the movie | — | opens the motion context menu immediately (`:1512`) |
| Right-click without moving >3px/5px | — | opens the motion context menu (`:1629-1634`, `:1643-1648`) |
| Ctrl + Left-drag | `cMovieDragModeInsDel` | drag right → `cmd.minsert(n, first, object=…)`; drag left → `cmd.mdelete(n, first+1, object=…)` (`:1671-1685`) |
| Ctrl+Shift + Left-drag | same, `DragColumn` | |
| Left-drag (no mod) | scrollbar | `SceneSetFrame(G,7,value)` (`:1533-1536`) |
| Ctrl + Middle-drag | `cMovieDragModeOblate` | `cmd.mview('clear', first=…, last=…, object=…)`; `DragColumn` → `object='same'` (`:1656-1669`) |
| Wheel | — | `SceneSetFrame(G, 5, ±1)` (`:1567`) |
| Ctrl+Shift + Wheel | — | adjust `movie_panel_row_height` ± 1 and reshape (`:1561-1564`) |
| Shift + Left | reserved ("TEMPORAL SELECTIONS -- TO COME") (`:1519-1520`) | no-op |

Drag feedback rectangles (`packages/engine/layer1/Movie.cpp:1797-1840`): white outline on the source
frame + grey filled box on the target; oblate = white outline + grey fill over the range;
ins/del = green fill when inserting, red fill when deleting.

Drag is abandoned if the pointer leaves ±50px vertically (`:1580`).

### 5.2 Panel context menus

Activated by `ExecutiveMotionMenuActivate` (`packages/engine/layer3/Executive.cpp:737`), which resolves
which row was hit and passes the 1-based frame number as a string.

**`camera_motion`** (`packages/engine/modules/pymol/menu.py:108-124`):
- `store` → `cmd.mview("store",first=F)`
- `store with scene` → submenu of up to 40 scene names, each
  `cmd.mview("store",scene=NAME,first=F)` (`packages/engine/modules/pymol/menu.py:54-59`)
- `store with state` → submenu `current` (`state=-1`), `1`, `n_state`, plus 8 evenly
  spaced states (`packages/engine/modules/pymol/menu.py:62-80`)
- `clear` → `cmd.mview("clear",first=F)`
- `reset camera motions` → `cmd.mview("reset")`
- `purge entire movie` → `cmd.mset()`
- `smooth key frames` → `a little` / `more (window=15)` / `a lot (window=30)`
  (`packages/engine/modules/pymol/menu.py:103-106`)
- `interpolate`, `reinterpolate`, `uninterpolate`

**`obj_motion`** (`packages/engine/modules/pymol/menu.py:126-143`): `drag`, `store`, `store with state`,
`reset` (`cmd.reset(object=…)`), `clear`, `reset object motions`,
`purge object motions` (`mview("purge",object=…)`), `smooth key frames`,
`interpolate` / `reinterpolate` / `uninterpolate`, all with `object="…"`.

---

## 6. Movie menu (menu bar) — full enumeration

Source: `packages/engine/modules/pymol/_gui.py:234-376` (toolkit-independent; consumed by
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:353` and `packages/engine/modules/pmg_tk/skins/normal/__init__.py:1072`).

```
Movie
├── Append ▸  0.25 / 0.5 / 1 / 2 / 3 / 4 / 6 / 8 / 12 / 18 / 24 / 30 / 48 / 60 second
│              → cmd.movie.add_blank(i)                       (_gui.py:235-238)
├── ─────
├── Program ▸
│   ├── Camera Loop ▸
│   │   ├── Nutate ▸ 15°/4s, 15°/8s, 15°/12s | 30°/4s, 30°/8s, 30°/12s, 30°/16s |
│   │   │            60°/8s, 60°/16s, 60°/24s, 60°/32s
│   │   │            → movie.add_nutate(sec,deg,start=%d)      (_gui.py:242-256)
│   │   ├── X-Rock ▸ 30°/{2,4,8}s | 60°/{4,8,16}s | 90°/{6,12,24}s | 120°/{8,16,32}s |
│   │   │            180°(179.99)/{12,24,48}s → movie.add_rock(sec,deg,axis='x',start=%d)
│   │   │                                                       (_gui.py:258-278)
│   │   ├── X-Roll ▸ 4 / 8 / 16 / 32 seconds → movie.add_roll(sec,axis='x',start=%d)
│   │   │                                                       (_gui.py:279-284)
│   │   ├── Y-Rock ▸ (same grid as X-Rock, axis='y')            (_gui.py:286-306)
│   │   └── Y-Roll ▸ 4 / 8 / 16 / 32 seconds                    (_gui.py:307-312)
│   ├── Scene Loop ▸
│   │   ├── Nutate ▸ / X-Rock ▸ / Y-Rock ▸   (rock = 4 / 2 / 1)
│   │   │      each: 30°/{2,4,8}s, 60°/{4,8,16}s, 90°/{6,12,24}s, 120°/{8,16,32}s
│   │   │      → "set sweep_angle,A;cmd.movie.add_scenes(None,S,rock=R,start=%d)"
│   │   │                                                       (_gui.py:315-327)
│   │   └── Steady ▸ 1/2/4/8/12/16/24 seconds each
│   │          → movie.add_scenes(None,V,rock=0,start=%d)       (_gui.py:329-333)
│   ├── State Loop ▸  Full Speed / 1/2 / 1/3 / 1/4 / 1/8 / 1/16 Speed
│   │                 ▸ no pause / 1 / 2 / 4 second pause
│   │                 → movie.add_state_loop(speed,pause,start=%d)   (_gui.py:336-348)
│   └── State Sweep ▸ (identical grid) → movie.add_state_sweep(...)  (_gui.py:336-348)
├── Update Last Program        → self.mvprg()                   (_gui.py:350)
├── Remove Last Program        → self.mvprg_remove_last()       (_gui.py:351)
├── ─────
├── Reset                      → "mset;rewind"                  (_gui.py:353)
├── ─────
├── Frame Rate ▸ 30 / 15 / 5 / 1 / 0.3 FPS  (radio on movie_fps)
│                ─────
│                ☑ Show Frame Rate (show_frame_rate)
│                Reset Meter → cmd.meter_reset()                (_gui.py:355-364)
├── ─────
├── ☑ Auto Interpolate     (movie_auto_interpolate)
├── ☑ Show Panel           (movie_panel)
├── ☑ Loop Frames          (movie_loop)
├── ☑ Draw Frames          (draw_frames)
├── ☑ Ray Trace Frames     (ray_trace_frames)
├── ☑ Cache Frame Images   (cache_frames)
├── Clear Image Cache      → cmd.mclear                          (_gui.py:366-372)
├── ─────
├── ☑ Static Singletons    (static_singletons, on=1)
└── ☑ Show All States      (all_states, on=1)                    (_gui.py:374-375)
```

Also in the File menu: **Export Movie As ▸ MPEG… / Quicktime… / ─── / PNG Images…**
(`packages/engine/modules/pymol/_gui.py:105-110`).

### 6.1 "Last program" bookkeeping

`PyMOLDesktopGUI.mvprg(command=None)` (`packages/engine/modules/pymol/_gui.py:958-968`): remembers
`movie_start = cmd.get_movie_length() + 1` and `movie_command = command % movie_start`,
then `cmd.do(movie_command)`. Calling with `None` re-runs the stored command ("Update Last
Program"). `mvprg_remove_last` (`:950-956`) issues `cmd.mdelete(-1, self.movie_start)`.
**This is client-side state** — it must live in the React store, not the bridge.

---

## 7. Movie programs (`pymol.movie`) — full API

`packages/engine/modules/pymol/movie.py`. FPS helper: `get_movie_fps` returns `movie_fps` or 30 if ≤0 (`:26`).

### 7.1 Legacy `mdo`-based generators (write per-frame commands)

| function | signature | source | behavior |
|---|---|---|---|
| `sweep` | `(pause=0, cycles=1)` | `:32` | builds an `mset` string `1 -N N -1` (or with `xpause` padding) repeated `cycles` times |
| `pause` | `(pause=15, cycles=1)` | `:44` | `1 x{p} 1 -N N x{p}` per cycle |
| `load` | `(pattern, nam="mov", **kw)` | `:56` | glob + `cmd.load` each match sorted into one object |
| `rock` | `(first=1,last=-1,angle=30,phase=0,loop=1,axis='y')` | `:64` | per-frame `mdo "turn axis,Δ"` from a sine sweep |
| `roll` | `(first=1,last=-1,loop=1,axis='y')` | `:93` | constant `turn axis,deg`; leading `-` in axis inverts |
| `tdroll` | `(first,rangex,rangey,rangez,skip=1)` | `:118` | sequential X then Y then Z rolls, `skip°` per frame |
| `zoom` | `(first,last,step=1,loop=1,axis='z')` | `:167` | `mdo "move axis,±step"`, reverses at halfway when looping |
| `nutate` | `(first,last,angle=30,phase=0,loop=1,shift=π/2)` | `:185` | 4 chained `turn` per frame (undo x/y, apply next x/y) |
| `screw` | `(first,last,step=1,angle=30,phase=0,loop=1,axis='y')` | `:214` | rock + `move z` |
| `timed_roll` | `(period=12.0,cycles=1,axis='y')` | `:247` | `mset 1 x{total}`, `mview reset`, then per-frame `turn` + `mview store` |

### 7.2 Key-frame based generators (the ones the Movie menu uses)

All take `start=0` meaning "append at `get_movie_length()+1`".

| function | signature | source | notes |
|---|---|---|---|
| `add_blank` | `(duration=12.0, start=0)` | `:268` | `mset "1 x{fps*duration}"` at `start`, then `frame(start)` |
| `add_roll` | `(duration=12.0, loop=1, axis='y', start=0)` | `:296` | 3 key frames at 0/⅓/⅔ with `power=1`; wrap-interpolate when `loop` and `start==1`, else an adjustment turn of `360/n_frame`; final `mview reinterpolate` if `movie_auto_interpolate` (`:342-344`) |
| `add_rock` | `(duration=8.0, angle=30.0, loop=1, axis='y', start=0)` | `:346` | key frames at ¼ and ¾ with `power=-1` |
| `add_nutate` | `(duration=8.0, angle=30.0, spiral=0, loop=1, offset=0, phase=0, shift=π/2, start=0)` | `:433` | stores **every** frame; `spiral=±1` ramps the amplitude in/out (`:472-477`); `loop` and `offset` documented as unused (`:450-452`) |
| `add_state_sweep` | `(factor=1, pause=2.0, first=-1, last=-1, loop=1, start=0)` | `:384` | 5 key frames 1→N→1 with pauses; `mview store …, state=…` |
| `add_state_loop` | `(factor=1, pause=2.0, first=-1, last=-1, loop=1, start=0)` | `:409` | 4 key frames 1→N |
| `add_scenes` | `(names=None, pause=8.0, cut=0.0, loop=1, rock=-1, period=8.0, animate=-1, start=0)` | `:562` | per scene: `mview store …, scene=NAME`; between scenes runs `_rock`/`_nutate` per `sweep_mode`; `rock` arg is `sweep_mode+1` (2=x-rock, 3=y-rock, 4=nutate); `animate<0` → `scene_animation_duration`; ends with `mview interpolate cut=…, wrap=loop` and `mview smooth` |

Internal helpers: `_rock` (`:490`, uses `sweep_angle`, `power=-1` keys),
`_nutate_sub` (`:517`), `_nutate` (`:543`).

### 7.3 Export

`cmd.mpng(prefix, first=0, last=0, preserve=0, modal=0, mode=-1, quiet=1, width=0,
height=0)` — `packages/engine/modules/pymol/moving.py:366`. `mode`: `2=ray`, `1=draw`, `0=normal`,
`-1=check ray_trace_frames/draw_frames` (`:392-393`). Asserts `mode in (-1,0,1,2)` (`:427`).
Routes through `_self._call_with_opengl_context` unless ray (`:431-434`).
C side `MoviePNG` (`packages/engine/layer1/Movie.cpp:819`) drives the modal loop `MovieModalPNG`
(`packages/engine/layer1/Movie.cpp:626`) with stages in `CMovieModal` (`packages/engine/layer1/Movie.h:22-50`).

`movie.produce(filename, mode='', first=0, last=0, preserve=0, encoder='', quality=-1,
quiet=1, width=0, height=0)` — `packages/engine/modules/pymol/movie.py:846`:
- `mode` shortcut dict `normal|draw|ray` → `0|1|2` (`:815-821`).
- Encoder autodetect: `.mpeg/.mpg` → `mpeg_encode`, else `ffmpeg`, else `convert`,
  else raise (`:915-925`).
- `mpeg_encode` uses `.ppm` frames; others `.png` and force `opaque_background` (`:928-936`).
- mp4/mov/webm: dimensions forced even, aspect-preserving from the viewport (`:938-951`).
- Temp dir is `<basename>.tmp`; `preserve<1` deletes it at the end (`:906-963`, `:812-813`).
- `mpng` writes `mov%04d.png` (`_prefix="mov"`, `:656`), then `_encode` (`:687`) waits for
  all files (polling `get_modal_draw()`, `:701`) and shells out.
- ffmpeg branches: GIF uses a two-pass palettegen/paletteuse (`:765-771`);
  webm uses `libvpx-vp9` with `crf = 65 - quality/2` (`:778-781`);
  otherwise `crf` 10/15/20 by quality and `-pix_fmt yuv420p` (`:782-785`).
- `convert` uses `-delay 100/fps` (`:794-802`).
- `mpeg_encode` maps quality to `1 + (100-q)*29/100` and snaps fps to
  `[23.976,24,25,29.97,30,50,59.94,60]` with a warning (`:732-743`).
- Sets `keep_alive` during export and `unset`s it afterwards (`:971`, `:811`).
- A `_watch` thread prints byte counts while encoding (`:658-685`).

### 7.4 Export dialog (Qt)

`packages/engine/modules/pmg_qt/file_dialogs.py:691` `file_save_mpeg(parent, _preselect=None)`,
form `packages/engine/modules/pmg_qt/forms/movieexport.ui`:

Fields: `input_width`, `input_height` (QSpinBox, seeded from `get_viewport()`,
`file_dialogs.py:795-797`); preset buttons `button_720p`, `button_480p`, `button_360p`
which set height and clamp aspect to ≤16:9 (`:788-793`, `:808-811`);
`input_encoder` combo — `""`, `ffmpeg`, `mpeg_encode`, `convert` (`movieexport.ui:161-177`);
`input_quality` spinbox seeded from `movie_quality`, disabled for `""`/`convert` (`:725`, `:798`);
`input_ray` checkbox seeded from `ray_trace_frames` (`:799-800`);
format radios `format_png/mp4/mpg/mov/gif` enabled per encoder support matrix
(`:702-707`); `button_ok`.
`_preselect='png'` hides the format group (`:737-739`); `_preselect='mov'` forces ffmpeg (`:747-750`).
Run: png → `cmd.mpng(fname, width, height, mode=2 if ray else 1, quiet=0, modal=-1)`
(`:772-777`); otherwise `cmd.movie.produce(fname, width, height, quality, mode, encoder, quiet=0)`
(`:781-785`).
Legacy Tk equivalent: a Pmw "Movie Settings" dialog with Encoding Quality / Ray Trace
Frames / Width / Height (`packages/engine/modules/pmg_tk/skins/normal/__init__.py:964-987`).

---

## 8. Scenes

### 8.1 `cmd.scene` — the one entry point

`packages/engine/modules/pymol/viewing.py:1034`:
```
scene(key='auto', action='recall', message=None, view=1, color=1, active=1,
      rep=1, frame=1, animate=-1, new_key=None, hand=1, quiet=1, sele="all")
```
Accepted actions (`viewing.py:56-60`): `store, recall, clear, insert_before,
insert_after, next, previous, start, update, rename, delete, order, sort, first, append`.

Python normalization before the C call (`viewing.py:1086-1115`):
- `key='auto'` + `action='recall'` → `action='next'` (that's why bare `scene` advances).
- `action='update'` preserves the existing message via `_scene_get_current_message`
  (`viewing.py:1007`, which reads the Message wizard that carries a `from_scene` attr).
- Deprecated aliases: `clear` → `delete`; `append`/`update` → `store`.
- Presentation auto-quit: if the same next/previous action repeats while `presentation`
  and `presentation_auto_quit` are on and `scene_current_name` is empty, try
  `chain_session()` (loads the next numbered `.pse/.psw`, `viewing.py:935-959`), else `cmd.quit()`.
- The C call is wrapped in `_self._call_with_opengl_context` (`viewing.py:1125`) because
  storing a scene grabs a thumbnail.

### 8.2 C implementation — `MovieSceneFunc`

`packages/engine/layer3/MovieScene.cpp:755`:
- `insert_before` / `insert_after` → remembers `scene_current_name`, rewrites action to
  `store`, then reorders with `MovieSceneOrderBeforeAfter` (`:772-777`, `:814-815`, `:733`).
- `next` / `previous` → `MovieSceneGetNextKey` then `recall` (`:779-783`).
  Wrap behavior: if `scene_loop` is off and we run off either end, returns `""`; an empty
  `scene_current_name` forces looping (`:700-728`).
- `start` → first key in order, then `recall` (`:784-788`).
- `key == "auto"` → `scene_current_name` (`:789-791`).
- `recall` with `key=="*"` → `MovieScenePrintOrder` (`:794-795`).
- `recall` with an empty key → clear `scene_current_name`, `ExecutiveSetObjVisib(G,"*",false)`
  (blank screen), clear the message (`:797-801`).
- `store`, `delete`, `rename`, `order`, `sort` (sorted natural order),
  `first` (move to top) (`:808-826`).
- Always sets `scenes_changed=true` and fires side effects — this is the **GUI refresh
  signal** the React scene panel should subscribe to (`:832-834`).

**Store** (`packages/engine/layer3/MovieScene.cpp:173`): key `""`/`"new"` → `getUniqueKey()`; new keys are
appended to `order`; `SceneSetNames` refreshes the scene-button list; `scene_current_name`
is set. `storemask` bits `STORE_VIEW|ACTIVE|COLOR|REP|FRAME|THUMBNAIL`
(`packages/engine/layer3/MovieScene.h:27-34`). Stores: message, `SceneGetView`, `SceneGetFrame`,
a 220×124 PNG thumbnail via `SceneDeferImage` (`:225-233`), per-atom `{color, visRep}`
keyed by `unique_id` for atoms of *enabled* objects only (`:236-252`), and per-object
`{color, visRep}` with the enabled bit packed into bit 0 of `visRep` (`:254-265`).

**Recall** (`packages/engine/layer3/MovieScene.cpp:458`, impl `:485`): each `recall_*` flag is ANDed with the
stored `storemask` (`:491-495`); atom color/rep restored by `unique_id` (`:506-528`);
objects invalidated with `cRepInvVisib`/`cRepInvColor` (`:571`); camera restored with
`SceneSetView(G, view, true, animate, 1)` where `animate == -1` resolves to
`get_scene_animation_duration` (`:576-579`).
`get_scene_animation_duration` (`:429-438`): `scene_animation` (-1 → fall back to
`animation`), 0 → no animation, else `scene_animation_duration`.
Frame recall (`MovieSceneRecallFrame`, `:404-424`): if the movie is playing use
`SceneSetFrame` mode 10 (seek to this scene's frame); if the frame is unchanged do
nothing; otherwise honor `scene_frame_mode` (0, or -1 with a movie defined ⇒ don't change
the frame). Note it round-trips through Python `cmd.set_frame` to avoid a `PBlock`
deadlock (`:421-423`) — relevant if we ever run the bridge on a non-main thread.

**Order** (`packages/engine/layer3/MovieScene.cpp:88`/`:95`, Python `cmd.scene_order`
`packages/engine/modules/pymol/viewing.py:961`): args `names` (space-separated string or list), `sort`
(bool), `location` ∈ `top|current|bottom` (`viewing.py:997-1005`). Duplicate keys are an
error (`MovieScene.cpp:126-128`); invalid location is an error (`:132-135`).

### 8.3 Scene helper cmds

| cmd | source | wire type |
|---|---|---|
| `cmd.get_scene_list()` | `packages/engine/modules/pymol/viewing.py:919` → `_cmd.get_scene_order` | `list[str]` in display order |
| `cmd.get_scene_thumbnail(name)` | `packages/engine/modules/pymol/viewing.py:923` | **PNG byte buffer** (used as `QPixmap.loadFromData(buf,"PNG")`, `packages/engine/modules/pmg_qt/scene_bin_gui.py:189-192`) |
| `cmd.get_scene_message(name)` | `packages/engine/modules/pymol/viewing.py:927` | `str` |
| `cmd.set_scene_message(name, message)` | `packages/engine/modules/pymol/viewing.py:931` | — |
| `cmd.scene_order(names, sort, location)` | `packages/engine/modules/pymol/viewing.py:961` | — |

`cmd.scene_recall_message` (`packages/engine/modules/pymol/viewing.py:1013`) is INTERNAL: it drives the
`message` wizard, tagging it `from_scene = 1`; an empty message tears the wizard down.
In React this becomes a scene-message overlay component, not a wizard.

Legacy compatibility (session loading only): `_legacy_scene` (`viewing.py:1132`),
`session_restore_scenes` (`:1199`), `_convert_legacy_scene` (`:1232`). Old scenes stored
`get_view()/get_vis()/get_frame()/get_colorection()` plus `_scene_<key>_<rep>` selections
over `rep_list` (`viewing.py:52-54`).

### 8.4 Scene menu (menu bar)

`packages/engine/modules/pymol/_gui.py:775-805`:
```
Scene
├── Scenes...                → self.scene_panel_menu_dialog        (_gui.py:776)
├── ─────
├── Next [PgDn]              → cmd.scene('', 'next')
├── Previous [PgUp]          → cmd.scene('', 'previous')
├── ─────
├── Append                   → "scene new, store"
├── Append... ▸ Camera       → "scene new, store, color=0, rep=0"
│              Color         → "scene new, store, view=0, rep=0"
│              Reps          → "scene new, store, view=0, color=0"
│              Reps + Color  → "scene new, store, view=0"
├── Insert Before            → cmd.scene('', 'insert_before')
├── Insert After             → cmd.scene('', 'insert_after')
├── Update                   → cmd.scene('auto','update')
├── ─────
├── Delete                   → cmd.scene('auto','clear')
├── ─────
├── Recall ▸ F1 … F12        → cmd.scene(k,'recall')               (_gui.py:61-65)
├── Store  ▸ F1 … F12        → cmd.scene(k,'store')
├── Clear  ▸ F1 … F12        → cmd.scene(k,'clear')
├── ─────
├── ☑ Buttons                (scene_buttons)
└── Cache ▸ Enable / Optimize / Read Only / Disable → cmd.cache(...)
```

### 8.5 Scene Panel dialog (Qt)

`packages/engine/modules/pmg_qt/scene_bin_gui.py:29` `ScenePanel(QWidget)`:
- Title "Scene Panel", 365×700 (`:45`, `:52`).
- Instruction label "Double click selected thumbnail to \nload into Workspace." (`:64-66`).
- **Add Scene** button → `cmd.scene('new','append',quiet=0)` then scroll to bottom (`:253-260`).
- Table columns enum `NAME=0, IMAGE=1, MESSAGE=2, ACTIONS=3` (`:16-20`), but the
  "condensed" layout shows only 2 columns `['Name','Scene Preview']` (`:213-215`), row
  height 100 (`:130`).
- Vertical headers are `↕` glyphs used as drag handles for reordering (`:231-242`),
  reorder → `cmd.scene_order(' '.join(names))` (`:379-387`).
- Rename by editing the NAME cell → `cmd.scene(old,'rename',new_key=new)`; names with
  spaces and blank names are rejected with a printed error (`:360-377`).
- **Update Scene** → `cmd.scene(name,'update')` + refresh thumbnail (`:262-274`).
- **Delete Scene** → `cmd.scene(name,'clear')` (`:276-290`).
- Double-click row → `cmd.scene(name,'recall')` (`:292-299`).
- Delete/Update buttons enabled only with a selection (`:351-358`).
- **Known placeholders**: message and actions columns are hard-coded strings
  `'This is a base message'` / `'Rock, zoom, something'` (`:170-171`) — the React version
  should use `cmd.get_scene_message` / `cmd.set_scene_message` instead.
- Repopulates on paint/focus events via an event filter (`:102-113`) — replace with the
  `scenes_changed` event.

### 8.6 Scene buttons (in-viewport overlay)

`SceneDrawButtons` (`packages/engine/layer1/Scene.cpp:2885`), enabled by `scene_buttons`
(`packages/engine/layer1/Scene.cpp:3456`). Names come from `SceneSetNames` (`:2870`) into
`CScene::SceneVec` of `SceneElem{name, rect, drawn}` (`packages/engine/layer1/SceneElem.h:7-12`,
`packages/engine/layer1/SceneDef.h:145`). Layout: `internal_gui_control_size` line height (`:2901`),
8dip char width (`:2896`), a vertical scrollbar when entries exceed the visible rows
(`:2924-2946`), name truncated to `max_char` (`:3014-3016`).
Colors: pressed `{0.7,0.7,0.7}`, current scene `{0.5,0.5,0.5}`, others `{0.25,0.25,0.25}`
(`:2891-2893`, `:3029-3038`).

Mouse (`packages/engine/layer1/SceneMouse.cpp:179` `SceneClickSceneButton`):
- Left press → `PressMode=1`; on release over the same button → `cmd.scene('NAME')`
  (`SceneMouse.cpp:1097-1104`).
- Middle press → *rapid browse*: recalls immediately on press, `animate=0` when Ctrl is
  held (`:196-212`); continues to recall while dragging over other buttons (`:1105-1114`).
- Right press → `PressMode=3`; on release over the same button opens the `scene_menu`
  popup (`:1117-1126`).
- Dragging with `PressMode=4` reorders: `cmd.scene_order([a,b])` or
  `cmd.scene_order([name], location='top')` when dropped on the first slot
  (`SceneMouse.cpp:1274-1300`).

`scene_menu` (`packages/engine/modules/pymol/menu.py:1842-1850`): header `Scene <name>`,
`rename` → `cmd.wizard("renaming", name, mode="scene")`, `update` → `cmd.scene(name,"update")`,
`delete` → `cmd.scene(name,"delete")`.

---

## 9. Camera: view get/set, interpolate, turn/move/zoom/orient/clip, rock

### 9.1 View vector

`cmd.get_view(output=1, quiet=1)` — `packages/engine/modules/pymol/viewing.py:634`. `_cmd.get_view`
returns 25 floats; Python slices to **18**: `r[0:3]+r[4:7]+r[8:11]+r[16:25]` (`:731`).
Layout documented at `:661-678`:
- 0–8: column-major 3×3 model→camera rotation
- 9–11: origin of rotation relative to camera (camera space)
- 12–14: origin of rotation (model space)
- 15: front plane distance
- 16: rear plane distance
- 17: orthoscopic flag (sign) and field of view when `abs(value) > 1`
- camera looks down −Z, +X left, +Y down.

`output` modes: 0 = print, 1 = don't, 2 = force print even while logging, 3 = return a
formatted `set_view (...)` string (`:651-657`, `:723-730`). When `logging` is on it writes
the matrix to the log file (`:695-712`).

`cmd.set_view(view, animate=0, quiet=1, hand=1)` — `packages/engine/modules/pymol/viewing.py:734`.
Accepts a string (parsed by `safe_list_eval`) or a sequence; **must be exactly 18 floats**
or it raises "bad view argument; should be a sequence of 18 floats" (`:764-769`).
It re-expands to the 25-float form with an embedded 4×4 (`:772-780`).

`cmd.view(key, action='recall'|'store'|'clear', animate=-1)` — `packages/engine/modules/pymol/viewing.py:783`.
This is a **pure-Python dictionary** `pymol._view_dict` + `_view_dict_sc` shortcut
(`:819-850`); `key='*'` lists or clears all (`:821-830`). Saved into sessions by
`session_save_views`/`session_restore_views` (`:1187`, `:1192`).
F1–F12 fall back to views when no scene matches (see §11).

### 9.2 Camera animation

`SceneSetView(G, view, quiet, animate, hand)` interpolates through `ani_elem` key frames
using `ViewElemInterpolate(..., 2.0F, 1.0F, true, 0.0F, hand, 0.0F)`
(`packages/engine/layer1/Scene.cpp:411-427`), with `timing` stamps for start and `start+duration`.

### 9.3 Camera commands

| cmd | signature | source |
|---|---|---|
| `zoom` | `(selection="all", buffer=0.0, state=0, complete=0, animate=0)` | `packages/engine/modules/pymol/viewing.py:66`; `animate<0` = default duration, `0` = none, `>0` = seconds (`:98-102`) |
| `center` | `(selection="all", state=0, origin=1, animate=0)` | `:134` |
| `orient` | `(selection="(all)", state=0, animate=0)` | `:310` — aligns principal components to XYZ |
| `origin` | `(selection="(all)", object=None, position=None, state=0)` | `:256` — `position` overrides selection (`:299-302`) |
| `clip` | `(mode, distance, selection=None, state=0)` | `:181`; modes `near, far, move, slab, atoms, near_set, far_set` (`:179`) |
| `get_clip` | `(quiet=1)` | `:228` → `_cmd.get_clip` |
| `turn` | `(axis, angle)` | `:1300` — rotates camera about a primary axis, centered on the origin |
| `move` | `(axis, distance)` | `:352` — translates the camera |
| `reset` | `(object='')` | `:1774` — identity rotation, origin ≈ center of mass, zoom to all; with an object name resets that object's matrix |
| `viewport` | `(width=-1, height=-1)` | `:1459`; tuple syntax deprecated with a warning (`:1476-1478`); off-GUI-thread calls are deferred through `cmd.do` (`:1480-1482`) |
| `get_viewport` | `(output=1, quiet=1)` | `:853`; `output==3` returns a deprecated string (`:893-895`) |
| `stereo` | `(toggle='on', quiet=1)` | `:1266`; `on, off, crosseye, walleye, quadbuffer, sidebyside, geowall, openvr` (`:1278`) |
| `full_screen` | `(toggle=-1)` | `:1329`; must run on the GUI thread, else deferred (`:1355-1357`) |
| `refresh` | `()` | `:1750` |
| `meter_reset` | `()` | `:1800` → `_cmd.reset_rate` (FPS counter) |
| `load_png` | `(filename, movie=1, stereo=-1, quiet=0)` | `:1814` |

### 9.4 Rock / spin / nutate (live, not movie)

`cmd.rock(mode=-1)` → `_cmd.rock` → `ControlRock(G, mode)` (`packages/engine/modules/pymol/viewing.py:1360`,
`packages/engine/layer1/Control.cpp:415-439`):
- `-2` = query only (returns the current `rock` setting without touching it)
- `-1` = toggle (default), `0` = off, `1` = on
- turning on restarts the sweep timer; any non-`-2` mode restarts the frame timer.
`cmd.ray` uses the `-2` query then `rock(0)` to stop rocking before rendering
(`packages/engine/modules/pymol/viewing.py:1738-1739`).

`SceneUpdateCameraRock` (`packages/engine/layer1/Scene.cpp:2373-2427`) — `sweep_mode`:
- 0 = Y-axis rock, 1 = X-axis rock, 2 = Z-axis rock ("useless!", `:2405`)
- 3 = nutate (combined X/Y sinusoid with a π/2 phase shift, amplitude ramped in over the
  first half period, `:2411-2425`)
- `sweep_angle <= 0` degenerates into a **continuous spin** at `10*sweep_speed/0.75`
  deg-ish per render second (`:2390-2392`).
- Phase from `sweep_phase`, speed from `sweep_speed`, tick rate from `rock_delay` ms.

`ControlIdling` (`packages/engine/layer1/Control.cpp:397-403`) keeps the idle loop alive while any of
sdof / movie playing / `rock` / `sculpting` is active.

---

## 10. Internal GUI control bar (9 buttons, in-viewport)

`CControl` block, `NButton = 9` (`packages/engine/layer1/Control.h`/`packages/engine/layer1/Control.cpp:62`), hit test
`which_button` = `(NButton * x) / control_width` (`packages/engine/layer1/Control.cpp:243-252`).
Release actions (`packages/engine/layer1/Control.cpp:290-380`):

| # | glyph | action | logged as |
|---|---|---|---|
| 0 | `|<` | `SceneSetFrame(G,4,0)` | `cmd.rewind()` |
| 1 | `<` | `SceneSetFrame(G,5,-1)` | `cmd.back()` |
| 2 | `■` | `MoviePlay(stop)`, also clears `sculpting` and `rock` | `cmd.mstop()` |
| 3 | `▶` | toggle play; Ctrl → rewind first | `cmd.mplay()` / `cmd.mstop()` |
| 4 | `>` | `SceneSetFrame(G,5,1)` | `cmd.forward()` |
| 5 | `>|` | `ending`; Ctrl → `middle` | `cmd.ending()` / `cmd.middle()` |
| 6 | seq | toggle `seq_view` + `SeqChanged` | `cmd.set('seq_view',0/1)` |
| 7 | rock | toggle `rock` + restart sweep/frame timers | `cmd.rock(1)` / `cmd.rock(0)` |
| 8 | full | full screen | `cmd.full_screen()` |

Double-clicking the left margin collapses/restores `internal_gui_width` to
`cControlMinWidth` (`packages/engine/layer1/Control.cpp:449-464`); dragging it resizes.

External Qt quick-button rows (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:223-253`) — the movie row is
`|<`, `<`, `Stop`, `Play`, `>`, `>|`, `MClear` bound to `cmd.rewind/backward/mstop/mplay/
forward/ending/mclear`; the row above has `Unpick`, `Deselect`, `Rock` (`cmd.rock`),
`Get View`; the top row has `Reset`, `Zoom (animate=1.0)`, `Orient (animate=1.0)`,
`Draw/Ray`. Legacy Tk equivalents at `packages/engine/modules/pmg_tk/skins/normal/__init__.py:266-281`.

---

## 11. Keyboard bindings in this area

`packages/engine/modules/pymol/shortcut_dict.py` (defaults; user-overridable through `cmd.set_key`,
`packages/engine/modules/pymol/controlling.py:746-757`):

| key | command | line |
|---|---|---|
| `left` | `_ backward` | `:11` |
| `right` | `_ forward` | `:12` |
| `pgup` | `scene action=previous` | `:13` |
| `pgdn` | `scene action=next` | `:14` |
| `home` | `zoom animate=-1` | `:15` |
| `end` | `mtoggle` | `:16` |
| `insert` | `rock` | `:17` |
| `SHFT-left/right` | `backward` / `forward` | `:18-19` |
| `SHFT-pgup/pgdn` | previous / next scene | `:20-21` |
| `SHFT-home` | `rewind` | `:22` |
| `SHFT-end` | `ending` | `:23` |
| `SHFT-insert` | `rock` | `:24` |
| `CTRL-left/right` | `backward` / `forward` | `:25-26` |
| `CTRL-pgup` | `_ scene new, insert_before` | `:27` |
| `CTRL-pgdn` | `_ scene new, insert_after` | `:28` |
| `CTRL-home` | `zoom animate=-1` | `:29` |
| `CTRL-end` | `scene new, store` | `:30` |
| `CTRL-insert` | `scene auto, store` | `:31` |
| `ALT-left/right` | `backward` / `forward` | `:43-44` |
| `ALT-pgup/pgdn` | `rewind` / `ending` | `:45-46` |
| `ALT-home` | `zoom animate=-1` | `:47` |
| `ALT-end` | `ending` | `:48` |
| `ALT-insert` | `rock` | `:49` |
| `CTRL-F1..F12` | `scene F<n>, store` | `:112-135` |
| `CTSH-F1..F12` | `scene SHFT-F<n>, store` | `:112-135` |

Bare **F1–F12 have no default binding**; `_special` (`packages/engine/modules/pymol/internal.py:447-484`)
first checks explicit `set_key` mappings, then tries `cmd.scene` against
`get_scene_list()`, then `cmd.view` against `pymol._view_dict_sc`, including a prefix
auto-completion pass with `key + '-'` (`:469-480`). Special key codes are at
`packages/engine/modules/pymol/internal.py:398-424`; modifier prefixes `'', SHFT, CTRL, CTSH, ALT`
(`:395-401`).

**Spacebar** (`packages/engine/layer1/Ortho.cpp:855-874`): only when the command line is empty. In
`presentation` mode plain space = `cmd.scene('','next')`, Shift+space = `rewind;mplay`.
Otherwise plain space = `mtoggle`, Shift+space = `rewind;mplay`.

---

## 12. Sequence viewer ("Seeker")

### 12.1 What it is today

Two C++ pieces:
- **`CSeq`** — the Ortho block: layout, scrollbar, hit-testing, GL text drawing
  (`packages/engine/layer1/Seq.h:73`, `packages/engine/layer1/Seq.cpp:259` `CSeq::draw`).
  Metrics: `LineHeight = 13`, `CharWidth = 8`, `ScrollBarWidth = 16`,
  `ScrollBarMargin = 2`, `CharMargin = 2` (`packages/engine/layer1/Seq.h:84-88`), all scaled by `DIP2PIXEL`.
  Total height = `LineHeight*NRow + 4` (+ scrollbar) (`packages/engine/layer1/Seq.cpp:190-201`).
- **`CSeeker`** — the data model + interaction handler (`packages/engine/layer3/Seeker.cpp:38`),
  installed via `SeqSetHandler` at the end of `SeekerUpdate` (`packages/engine/layer3/Seeker.cpp:1948`).

Refresh protocol: `SeqChanged` marks "rebuild" and `SeqDirty` marks "recompute selection
highlight" (`packages/engine/layer1/Seq.cpp:136-148`); `SeqUpdate` runs `SeekerUpdate` then
`Handler->refresh` (`packages/engine/layer1/Seq.cpp:88-102`).

### 12.2 Row/column data model

`CSeqRow` (`packages/engine/layer1/Seq.h:42-57`): `txt` (one flat char buffer for the row), `col[]`,
`fill[]`, `char2col[]` (character-offset → 1-based column index),
`atom_lists[]` (a packed, `-1`-terminated list of atom indices per column),
`name` (object name), `color` (object color), `label_flag`, `column_label_flag`,
`ext_len`, `title_width`.

`CSeqCol` (`packages/engine/layer1/Seq.h:25-37`): `start`/`stop` (slice into `txt`), `offset`
(aligned character column), `atom_at` (index into `atom_lists`), `inverse`
(**selected** — drives the inverted-video highlight, `packages/engine/layer1/Seq.cpp:465-482`),
`unaligned`, `spacer`, `state`, `color` (PyMOL color index), `tag` (alignment tag),
`is_abbr`, `hint_no_space`.

So the wire payload for a React sequence viewer is, per object row:
`{ object, objectColor, isLabelRow, cells: [{ text, offset, colorIndex|rgb, selected,
spacer, unaligned, state, tag, atomIndices }] }`, plus the label rows.
**No such cmd API exists today** — see §14.

### 12.3 Display modes (`seq_view_format`)

`SeekerUpdate` (`packages/engine/layer3/Seeker.cpp:969`), `codes` read from `seq_view_format`
(`:1016`), overridden to `4` for discrete objects when `seq_view_discrete_by_state`
(`:1017-1020`):

| value | mode | source | notes |
|---|---|---|---|
| 0 | **one-letter residue codes** | `:1260-1328` | `SeekerGetAbbr` maps 3-letter → 1-letter (`:685-906`); water → `'O'`; organic/inorganic get no abbreviation and fall back to the full `resn` padded with spaces (`:1284-1311`) |
| 1 | **explicit residue codes** (3-letter) | `:1329-1370` | space-separated; empty `resn` renders `''` |
| 2 | **atom names** | `:1371-1395` | one column per atom |
| 3 | **chain identifiers** | `:1396-1422` | one column per chain |
| 4 | **state names** | `:1423-1482` | discrete objects list per-CoordSet names; non-discrete objects enumerate all states with `r1->state = b+1` and a shared atom list (`:1448-1481`) |
| 5 | movie frames | `:1483-1484` | **declared but empty — no-op** |

Menu labels (`packages/engine/modules/pymol/_gui.py:379-387`): Residue Codes (0), Residue Names (1),
Chain Identifiers (3), Atom Names (2), States (4).

### 12.4 Label modes (`seq_view_label_mode`, global, default 2)

`packages/engine/layer3/Seeker.cpp:987`, `:1028-1101`:
- **2 — All Residue Numbers**: a dedicated label row above *every* object row.
- **1 — Top Sequence Only**: a single label row for the first object only.
- **0 — Object Names Only**: no label rows; the object name `/name` occupies the
  left-hand column of the sequence row itself (`column_label_flag`, `:1079-1092`).
- **3 — No Labels**: a zero-length spacer column (`:1093-1101`).

Label rows also carry `/segi/chain/` breadcrumbs, re-emitted whenever the segment
(`:1147-1182`) or chain (`:1183-1215`) changes.

Residue-number labels are laid out in a third pass (`packages/engine/layer3/Seeker.cpp:1820-1914`):
drawn every `seq_view_label_spacing` residues (default 5) offset by
`seq_view_label_start` (default 1) (`:1842-1843`, `:1858-1862`), forced at sequence gaps
(`:1866-1867`), forced if more than `2*div` were skipped (`:1868-1869`), never twice for
the same residue (`:1871-1872`), and suppressed if they would collide with a fixed label
(`:1895-1904`). In atom-name mode the label is `resn` + `` ` `` + `resi` (`:1878-1887`).

### 12.5 Gaps (`seq_view_gap_mode`, global, default 1)

`packages/engine/layer3/Seeker.cpp:1009`, `:1230-1258`. `GapMode::NONE / ALL(1) / SINGLE(2)`. Gaps are
only inserted between atoms in the same chain, both polymer, and only when no alignment is
active (`:1232-1235`). Gap count = `resv - last_resv - 1`; SINGLE clamps to 1 (`:1238-1240`).
More than `MAXCONSECUTIVEGAPS = 9` (`:983`) collapses to `"---...---"` (mode 0) /
`"---...--- "` (mode 1) (`:1275-1277`, `:1346-1348`). Gap columns get
`color = seq_view_fill_color` and `spacer = true` (`:1250-1251`).
Menu labels: No Gaps (0), All Gaps (1), Single Gap (2) (`packages/engine/modules/pymol/_gui.py:401-405`).

### 12.6 Alignment mode

When an alignment is active (`ExecutiveGetActiveAlignmentSele`,
`packages/engine/layer3/Executive.cpp:3375`, resolved from `seq_view_alignment` or the first enabled
alignment object, `:3391-3409`), the second pass lines rows up by `tag` instead of by
column index (`packages/engine/layer3/Seeker.cpp:1584-1818`). Tags come from `SeekerFindTag`
(`:928-967`), which prefers the guide atom for residue-level modes.
`seq_view_unaligned_mode` (0–5) decides staggering (`:1590-1599`) and how unaligned
residues are colored (`packages/engine/layer1/Seq.cpp:320-339`, `:423-455`): modes 1/4 average the residue
color with the background, 2/5 average with `seq_view_unaligned_color`, 3 leaves the
color alone; otherwise the unaligned color is used flat.
`seq_view_fill_char` (default `-`) fills alignment gaps in `seq_view_fill_color`
(`packages/engine/layer1/Seq.cpp:316`, `:341-346`, `:488-505`).

### 12.7 Coloring

Per-column color (`packages/engine/layer3/Seeker.cpp:1313-1318` and mirrored in the other code paths):
- atom not present in the current state → `seq_view_fill_color`
- `seq_view_color < 0` (default `-1`) → `SeekerFindColor` (`:908-926`): prefer the guide
  atom's color, else the last carbon's color, else the first atom's color
- otherwise the explicit `seq_view_color`.
Row label text uses `seq_view_label_color` (default `front`) (`packages/engine/layer1/Seq.cpp:269-271`).
Background is `bg_rgb`, or `bg_rgb_top`/`bg_rgb_bottom` when `bg_gradient` and depending on
`seq_view_location` (`packages/engine/layer1/Seq.cpp:273-281`).

### 12.8 Placement / overlay

`seq_view_location` — 0 = top, 1 = bottom (`packages/engine/layer1/Ortho.cpp:2181`, `:2418`).
`seq_view_overlay` — draw over the 3D scene instead of reserving space
(`packages/engine/layer1/Seq.cpp:282-289`, `packages/engine/layer1/Ortho.cpp:2425-2437`, `packages/engine/layer5/main.cpp:817`, `:1500`).
The whole viewer is gated per object by the `seq_view` setting **and** the object being
enabled, and `_`-prefixed objects are skipped when `hide_underscore_names`
(`packages/engine/layer3/Seeker.cpp:991-993`). Max 50 rows (`max_row = 50`, `packages/engine/layer3/Seeker.cpp:980`, `:1013`).

### 12.9 Interaction — the full grammar

Hit test: `SeqFindRowCol` (`packages/engine/layer1/Seq.cpp:36-86`) maps (x,y) → (row, col) via
`char2col`, accounting for `NSkip` (horizontal scroll) and `label_flag` rows (which are
not clickable). During a drag the row is pinned to `LastRow` (`packages/engine/layer1/Seq.cpp:158`, `:175`).

`SeekerClick` (`packages/engine/layer3/Seeker.cpp:317`):

| input | effect |
|---|---|
| **Left click on a cell** | toggles that residue in the active selection: `SeekerSelectionToggle(..., inc_or_excl = !col->inverse)` (`:450-456`). Starts a drag range (`dragInfo.start_col/last_col/row/dir`). |
| **Shift + Left click** on the same row | *continuation* — extends the existing range (`:350-355`, `:447-448` → `SeekerDrag`) |
| **Ctrl + Left click** | additionally `SeekerSelectionCenter(G, 2)` = center on the active selection (`:419-421`, `:460-461`) |
| **Left drag** | extends/retracts the range with correct direction flipping; `SeekerSelectionToggleRange` per span (`:527-624`). Ctrl during drag re-centers each step (`:619-621`) |
| **Middle click** | *browse*: builds `cTempCenterSele` from that column and `cmd.center`s it (`:397-412` → `SeekerSelectionUpdateCenter` `:248`, `SeekerSelectionCenter` `:275`) |
| **Ctrl + Middle** | same but `cmd.zoom` instead of `cmd.center` (action 1, `:405`, `:291-298`) |
| **Shift + Middle drag** | accumulates columns into the center selection instead of restarting (`:633-664`) |
| **Right click on a selected cell** | opens the `pick_sele` menu for the active selection (`:363-364`) |
| **Right click on an unselected cell** | builds `cTempSeekerSele` and opens the `seq_option` menu, titled with `ObjectMoleculeGetAtomSele(...)` truncated at the last `/` (`:365-393`, menu at `packages/engine/modules/pymol/menu.py:1800-1840`) |
| **Right click outside any cell** | `pick_sele` menu for the active selection (`packages/engine/layer1/Seq.cpp:240-248`) |
| **Left double-click outside any cell** (<0.35 s, `cDoubleTime` `packages/engine/layer3/Seeker.cpp:315`) | clears the active selection: `cmd.select('<sele>','none', enable=1)` (`:328-341`) |
| **Wheel** | horizontal scroll by ±1 (`packages/engine/layer1/Seq.cpp:218-223`) |
| **Click on the scrollbar strip** | scrollbar drag (`packages/engine/layer1/Seq.cpp:226-231`) |
| Clicking a cell that carries a `state` | sets that object's `state` setting and `SceneChanged` (`packages/engine/layer3/Seeker.cpp:463-466`, `:408-411`) |
| State-mode guard | in `codes == 4` on non-discrete objects the columns are **not** selectable (`:427`) |

Selection algebra (`SeekerSelectionToggle`, `packages/engine/layer3/Seeker.cpp:169-246`;
range variant `:70-167`):
- The active selection name comes from `ExecutiveGetActiveSeleName(create_new=true)`
  (`packages/engine/layer3/Executive.cpp:3420`), auto-numbered `selNN` when `auto_number_selections`
  (`:3436-3443`).
- `sele_mode_kw` = `SceneGetSeleModeKeyword` (`packages/engine/layer1/Scene.cpp:504`), one of
  `"" | byresi | bychain | bysegi | byobject | bymol | bca.` indexed by
  `mouse_selection_mode` (`packages/engine/layer1/Scene.cpp:460-468`).
- Include: `((KW(?sele)) or KW(?tmp))`; Exclude: `((KW(?sele)) and not KW(?tmp))`;
  Fresh: `KW(?tmp)` (`packages/engine/layer3/Seeker.cpp:130-140`, `:202-221`).
- Emits an equivalent `cmd.select("<name>","<expr>",enable=1)` line to the log
  (`:146-149`, `:227-230`) — **this is exactly the API the React component should call**.
- `auto_show_selections` → `ExecutiveSetObjVisib(sele, 1)` (`:161-162`, `:241-242`).

Highlight sync: `SeekerRefresh` (`packages/engine/layer3/Seeker.cpp:475-525`) recomputes `col->inverse`
for every column by testing `SelectorIsMember(atInfo[at].selEntry, sele)` against the
active selection (falling back to a selection literally named `_seeker_hilight`, `:484`).

Drag box overlay: `CSeqHandler::box_active / box_row / box_start_col / box_stop_col`
(`packages/engine/layer1/Seq.h:67-70`), drawn as a line loop with spacer trimming (`packages/engine/layer1/Seq.cpp:510-563`).

The scrollbar itself renders a **mini-map** of the selection: colored ticks per contiguous
`inverse` run, one horizontal band per non-label row (`packages/engine/layer1/Seq.cpp:564-696`).

---

## 13. Settings that this area owns

From `packages/engine/layer1/SettingInfo.h` (id, name, scope, default):

**Movie:** `single_image` 15 g 0 (`:99`) · `movie_delay` 16 g 30.0 (`:100`) ·
`ray_trace_frames` 30 g 0 (`:114`) · `cache_frames` 31 g 0 (`:115`) ·
`all_states` 49 object 0 (`:133`) · `static_singletons` 82 object 1 (`:166`) ·
`movie_loop` 299 object 1 (`:388`) · `movie_fps` 550 g 30.0 (`:650`) ·
`movie_animate_by_frame` 565 g 0 (`:665`) · `movie_rock` 572 g -1 (`:672`) ·
`keep_alive` 607 g 0 (`:707`) · `show_frame_rate` 617 g 0 (`:717`) ·
`movie_panel` 618 g 1 (`:718`) · `movie_auto_store` 620 object -1 (`:720`) ·
`movie_auto_interpolate` 621 object 1 (`:721`) · `movie_panel_row_height` 622 g 15 (`:722`) ·
`movie_quality` 634 g 90 (`:734`) · `frame` 194 g 1 (`:279`) · `state` 193 object 1 (`:278`).
Also `draw_frames` (referenced by the menu, `packages/engine/modules/pymol/_gui.py:369`, and by
`cmd.mpng` mode resolution `packages/engine/modules/pymol/moving.py:392-393`).

**Rock / sweep:** `sweep_angle` 26 g 20.0 (`:110`) · `sweep_speed` 27 g 0.75 (`:111`) ·
`rock_delay` 56 g 30.0 (`:140`) · `sweep_mode` 401 g 0 (`:496`) · `sweep_phase` 402 g 0.0 (`:497`).

**Scene:** `animation` 388 g 1 (`:483`) · `animation_duration` 389 g 0.75 (`:484`) ·
`scene_animation` 390 g -1 (`:485`) · `scene_current_name` 396 g "" (`:491`) ·
`presentation` 397 g 0 (`:492`) · `presentation_mode` 398 g 1 (`:493`) ·
`scene_loop` 400 g 0 (`:495`) · `scene_restart_movie_delay` 403 g 1 (`:498`) ·
`mouse_restart_movie_delay` 404 g 0 (`:499`) · `scene_animation_duration` 411 g 2.25 (`:506`) ·
`presentation_auto_quit` 415 g 1 (`:510`) · `presentation_auto_start` 417 g 1 (`:512`) ·
`scene_buttons_mode` 598 **unused** 1 (`:698`) · `scene_buttons` 599 g 1 (`:699`) ·
`scene_frame_mode` 623 g -1 (`:723`) · `scenes_changed` (change signal,
`packages/engine/layer3/MovieScene.cpp:833`).

**Sequence viewer:** `seq_view` 353 object 0 (`:448`) ·
`seq_view_label_spacing` 355 object 5 (`:450`) · `seq_view_label_start` 356 object 1 (`:451`) ·
`seq_view_format` 357 object 0 (`:452`) · `seq_view_location` 358 g 0 (`:453`) ·
`seq_view_overlay` 359 g 0 (`:454`) · `seq_view_color` 362 ostate "-1" (`:457`) ·
`seq_view_label_mode` 363 g 2 (`:458`) · `seq_view_discrete_by_state` 410 object 1 (`:505`) ·
`seq_view_alignment` 513 g "" (`:613`) · `seq_view_unaligned_mode` 514 g 0 (`:614`) ·
`seq_view_unaligned_color` 515 g "-1" (`:615`) · `seq_view_fill_char` 516 g "-" (`:616`) ·
`seq_view_fill_color` 517 g "104" (`:617`) · `seq_view_label_color` 518 g "front" (`:618`) ·
`seq_view_gap_mode` 767 g 1 (`:877`). Related: `mouse_selection_mode` 354 g 1 (`:449`),
`auto_show_selections`, `hide_underscore_names`.

Display menu entries that map to these: `packages/engine/modules/pymol/_gui.py:378-406`.

---

## 14. What upstream does not expose, and what the bridge added

Four things this area needs have no upstream Python API. Each is now supplied by a bridge
module that installs extra callables onto the `cmd` namespace, so the client reaches them the
same way it reaches any other `cmd.*` symbol.

1. **No structured movie-panel data upstream.** `cmd.mdump` only prints
   (`packages/engine/layer1/Movie.cpp:378-403`). `MovieGetSpecLevel(G, frame)` (`packages/engine/layer1/Movie.cpp:163`)
   is C-only; it is not in the `_cmd` method table (`packages/engine/layer4/Cmd.cpp:6549-6562`).
   Supplied as `cmd.get_movie_panel` / `get_movie_status` / `get_movie_key_frames`
   (`packages/bridge/tenmol_bridge/panels/movie.py`, `EXPORTS`), typed in
   `packages/protocol/src/topics/movie_panel.ts`, consumed by
   `apps/web/src/features/movie/movieSource.ts`.
2. **No structured sequence-viewer data upstream.** `SeekerUpdate` writes only into
   `G->Seq->Row` (`packages/engine/layer3/Seeker.cpp:1947`). `cmd.get_fastastr`
   (`packages/engine/modules/pymol/exporting.py:170`) gives sequences but **no colors, no per-cell atom
   indices, no selection state, no gaps, no alignment offsets**, and it only covers
   polymers (`:198`). `cmd.get_seq_align_str` exists (`packages/engine/layer4/Cmd.cpp:6490`) but is an
   alignment export, not the viewer model. The §12.2 payload is rebuilt from `cmd` queries in
   `packages/bridge/tenmol_bridge/panels/seqview.py` (entry point `tenmol_seqview`), consumed
   by `apps/web/src/features/seqview/source.ts`.
3. **No scene metadata bundle upstream.** Qt makes N round-trips
   (`get_scene_list` + `get_scene_thumbnail` per scene, `scene_bin_gui.py:169-192`).
   Supplied as `cmd.get_scene_panel` + `cmd.get_scene_thumbnail_png`
   (`panels/movie.py`), backed by the existing `MovieSceneGetThumbnail` /
   `MovieSceneGetMessage` (`packages/engine/layer3/MovieScene.h:170-173`).
4. **No event stream upstream.** Everything is polled or push-from-C via `OrthoDirty`.
   The bridge publishes `frame`, `view`, `settings`, `objects`, `feedback` and the rest as
   protocol topics (`packages/protocol/src/topics/`), with scene changes reaching the client
   through `scenes.ts` and playback state through `movie.ts`.

**Menus are Python data, not C.** `get_menudata` (`packages/engine/modules/pymol/_gui.py:55`) and
`packages/engine/modules/pymol/menu.py` return plain nested lists of
`('command'|'menu'|'check'|'radio'|'separator', label, payload)`, which the port consumes
nearly verbatim (compare the Qt walker at
`packages/engine/modules/pmg_qt/pymol_qt_gui.py:298-342` with
`apps/web/src/features/menubar/menuSource.ts`).

---

## 15. Where each surface lives now

| Surface | Replaces | Backend contract |
|---|---|---|
| `features/movie/movieMenu.ts` | `_gui.py:234-376` | `cmd.movie.*`, `cmd.mset/mclear/meter_reset`, settings |
| `features/movie/MovieTimeline.tsx` | `CMovie` block (`packages/engine/layer1/Movie.cpp:1741`) | `cmd.get_movie_panel`; writes via `cmd.mmove/mcopy/minsert/mdelete/mview` |
| `features/movie/TransportBar.tsx` | `CControl` (`packages/engine/layer1/Control.cpp:288` release, `:536` draw) + Qt row (`pymol_qt_gui.py:241-247`) | `rewind/backward/mstop/mplay/mtoggle/forward/ending/middle/mclear/rock/full_screen` |
| `features/movie/MovieTimeline.tsx` state slider | scrollbar in `CMovie::draw` (`packages/engine/layer1/Movie.cpp:1775`) | `cmd.frame`, `cmd.set_frame`, `count_frames`, `count_states` |
| `features/scenes/ScenePanel.tsx` | `scene_bin_gui.py:29` | `cmd.get_scene_panel`, `cmd.scene`, `cmd.scene_order`, `set_scene_message` |
| `features/scenes/sceneButtonGeometry.ts` | `SceneDrawButtons` (`packages/engine/layer1/Scene.cpp:2885`) | `get_scene_list`, `scene_current_name`, `cmd.scene`, `cmd.scene_order` |
| `features/scenes/SceneMenu.tsx` | `menu.py:1842` | `cmd.scene(...,'update'/'delete'/'rename')` |
| `features/seqview/SequenceViewer.tsx` | `CSeq`+`CSeeker` (`packages/engine/layer1/Seq.cpp:259`, `packages/engine/layer3/Seeker.cpp:969`) | `tenmol_seqview`; writes via `cmd.select(name, expr, enable=1)`, `cmd.center/zoom`, `cmd.set('state',…)` |
| `features/seqview/grammar.ts` | `menu.py:1800`, `:1709` | the literal command strings in those menus |
| `features/movie/ExportDialog.tsx` | `file_dialogs.py:691` + `movieexport.ui` | `cmd.mpng`, `cmd.movie.produce`, `get_viewport` |
| `features/movie/motionMenu.ts` | `menu.py:108`, `:126` | `cmd.mview(...)`, `cmd.mset()`, `cmd.reset(object=)` |
| `packages/viewport/src/resize.ts` | `cmd.viewport` (`viewing.py:1459`) | resizes the WebGL canvas *and* the backend offscreen buffer |

Paths are relative to `apps/web/src/` unless stated otherwise.
| Key handler | `shortcut_dict.py`, `internal.py:447` | forward to `cmd.do`, with F1–F12 scene/view fallback replicated client-side |

Rendering notes for the timeline and sequence viewer: both are dense 1-D grids
(hundreds to tens of thousands of cells). Use a canvas/WebGL2 layer with an offscreen
color-index texture for hit-testing rather than one DOM node per cell — the existing C code
already thinks in terms of "column index → pixel offset" (`CSeqCol::offset`,
`ViewElemXtoFrame`), so the same math ports directly.
