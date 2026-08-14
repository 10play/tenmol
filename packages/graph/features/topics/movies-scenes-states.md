---
name: movies-scenes-states
kind: feature
category: movies-scenes-states
subcategory: frames / states / movie / scene / camera / sequence viewer
summary: The coupled model of molecular states, movie frames, key-frame animation, named scenes, camera views and the sequence viewer.
parity: implemented
---

# Movies, Scenes, States & the Camera

PyMOL couples four subsystems here: **states** (per-object coordinate sets), **frames**
(the viewer's movie timeline), **scenes** (named snapshots of view + reps + colors +
frame + message + thumbnail), and the **camera view** vector that every animation
interpolates. This reference covers the command surface for each. The engine keeps a
single global movie and a single clock (`SceneIdle`), so playback, rock and scene
animation are all backend-driven.

> Parity note: feature-parity area 7 ("Movies, scenes, states, camera, sequence viewer")
> is tracked at 32/32 in `docs/feature-parity.md`. Where the TypeScript engine
> (`packages/engine-ts`) ships only a stub, the per-feature Source note says so.

---

## state-vs-frame

**Purpose.** Objects have *states* (discrete coordinate sets, e.g. NMR models or a
trajectory). The viewer has *frames* (the movie timeline). By default 1 frame = 1 state; a
movie (`mset`) defines an arbitrary frame→state map.

**Behaviour.** `MovieFrameToIndex` resolves a frame to a state: a per-frame
`ViewElem[frame].state_flag` (set by `mview store, state=…`) overrides the `Sequence[]`
map defined by `mset`; otherwise `Sequence[frame]`; with no movie defined the frame index
*is* the state index. The `frame` (global) and `state` (per-object) settings track the
current values. `all_states` overlays every state at once; `static_singletons` keeps a
single-state object visible in every frame regardless of the movie.

**Related.** [mset](#mset), [get_state](#get_state), [get_frame](#get_frame),
[all_states](#all_states), [static_singletons](#static_singletons).

**Source.** `packages/engine/layer1/Movie.cpp:979` `MovieFrameToIndex`;
`docs/movies-scenes-states.md` §1.

---

## get_state

**Purpose.** Return the object's current display state (1-based).

**Syntax.** `get_state()` — no arguments.

**Behaviour.** Returns `_cmd.get_state()+1`. Takes **no lock** (safe from `cmd.refresh`).
States and frames are 1:1 unless a movie remaps them.

**Source.** `packages/engine/modules/pymol/moving.py:958`.

---

## get_frame

**Purpose.** Return the current movie frame index (1-based).

**Syntax.** `get_frame()` — no arguments.

**Behaviour.** Returns `_cmd.get_frame()`. **No lock.** With no movie defined this equals
`get_state()`.

**Source.** `packages/engine/modules/pymol/moving.py:984`. Engine-ts ships a fixed stub
(`() => 1`); the frame cursor lives on the mutating commands.

---

## set_frame

**Purpose.** Jump the viewer to an absolute frame.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `frame` | int | `1` | 1-based target frame |
| `mode` | int | `0` | `SceneSetFrame` mode (0 = absolute) |

**Behaviour.** Calls `SceneSetFrame(G, mode, frame-1)`. A frame change clamps to
`[0, NFrame)`, recomputes the state, at frame 0 recalls the `mmatrix` matrix, sets the
`frame`/`state` settings and optionally runs that frame's movie command.

**Source.** `packages/engine/modules/pymol/moving.py:898`.

---

## frame

**Purpose.** Set the viewer to a specific movie frame (the plain navigation verb).

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `frame` | int | — | frame number to display |
| `trigger` | int | `-1` | run the frame's movie command |
| `scene` | int | `0` | recall the frame's scene |

**Behaviour.** Calls `_cmd.frame(COb, frame-1, trigger)`. Distinct from `set_frame`: it is
the user-facing "go to frame N".

**Examples**
```
frame 30
```

**Related.** [set_frame](#set_frame), [count_frames](#count_frames).

**Source.** `packages/engine/modules/pymol/moving.py:460`.

---

## forward

**Purpose.** Advance the movie one frame.

**Syntax.** `forward()`.

**Behaviour.** `SceneSetFrame(G, 5, +1)` — relative + auto movie command.

**Source.** `packages/engine/modules/pymol/moving.py:819`.

---

## backward

**Purpose.** Step the movie back one frame.

**Syntax.** `backward()` (aliased `back`).

**Behaviour.** `SceneSetFrame(G, 5, -1)`.

**Source.** `packages/engine/modules/pymol/moving.py:846`.

---

## rewind

**Purpose.** Go to the first frame.

**Syntax.** `rewind()`.

**Behaviour.** `SceneSetFrame(G, 4, 0)` — absolute + auto movie command.

**Source.** `packages/engine/modules/pymol/moving.py:874`.

---

## ending

**Purpose.** Jump to the last frame.

**Syntax.** `ending()`.

**Behaviour.** `SceneSetFrame(G, 6, …)` — end + auto movie command.

**Source.** `packages/engine/modules/pymol/moving.py:911`. Engine-ts stub (`() => null`).

---

## middle

**Purpose.** Jump to the middle frame.

**Syntax.** `middle()`.

**Behaviour.** `SceneSetFrame(G, 3, …)` — middle + auto movie command.

**Source.** `packages/engine/modules/pymol/moving.py:934`.

---

## count_frames

**Purpose.** Number of frames defined for the movie.

**Syntax.** `count_frames(quiet=1)`.

**Source.** `packages/engine/modules/pymol/querying.py:759`. Engine-ts stub.

---

## count_states

**Purpose.** Number of states spanned by a selection.

**Syntax.** `count_states(selection='(all)', quiet=1)`.

**Source.** `packages/engine/modules/pymol/querying.py:703`;
`packages/engine-ts/src/cmd/analysis.ts:224`.

---

## get_movie_length

**Purpose.** Frames *explicitly* defined by `mset`, excluding implicit molecular states.

**Syntax.** `get_movie_length(quiet=1, images=-1)`.

**Behaviour.** The internal value is negative when the movie is implicit; the `images`
argument folds that into the reported count.

**Source.** `packages/engine/modules/pymol/querying.py:730`. Engine-ts stub.

---

## get_movie_playing

**Purpose.** Whether the movie is currently playing.

**Syntax.** `get_movie_playing()` → bool.

**Behaviour.** `MoviePlaying()` also returns true while movie commands evaluate, and false
when the movie is locked.

**Source.** `packages/engine/modules/pymol/moving.py:64`. Engine-ts stub.

---

## get_movie_locked

**Purpose.** Whether movie commands are currently suppressed (locked).

**Syntax.** `get_movie_locked()` → bool.

**Source.** `packages/engine/modules/pymol/querying.py:814`.

---

## mset

**Purpose.** Define the frame→state program — the mini-language mapping movie frames onto
molecular states. This is how you build a trajectory playback or a state sweep.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `specification` | str | `''` | frame/state spec (see grammar) |
| `frame` | int | `1` | 1-based frame to start writing at |
| `freeze` | int | `0` | suppress recompute/refresh |

**Behaviour.** The mini-language is parsed entirely in Python then handed to `_cmd.mset` as
a space-separated 0-based state list. Tokens (evaluated left→right against a running
state cursor): bare `N` emits one frame of state N; `xN` repeats the previous state until
its run totals N frames; `-N` ramps from the previous state to N inclusive (direction
auto). Redefining the movie clears existing `mdo` commands.

**Examples**
```
mset 1
mset 1 x10
mset 1 x30 1 -15 15 x30 15 -1
```

**Related.** [madd](#madd), [mview](#mview), [mdo](#mdo).

**Source.** `packages/engine/modules/pymol/moving.py:691`; C `MovieSet`
`packages/engine/layer1/Movie.cpp:877`; `packages/engine-ts/src/cmd/system.ts:169`.

---

## madd

**Purpose.** Extend an existing movie using the same syntax as `mset` (append instead of
replace).

**Syntax.** `madd(specification='', frame=0, freeze=0)`.

**Behaviour.** Literally `mset(spec, frame, freeze)` appending at the current end.

**Source.** `packages/engine/modules/pymol/moving.py:677`;
`packages/engine-ts/src/cmd/system.ts:182`.

---

## mdo

**Purpose.** Define (replace) the command string executed every time a given frame plays —
a "generalized movie command".

**Syntax.** `mdo(frame, command)`.

**Behaviour.** `_cmd.mdo(COb, frame-1, command, 0)` (replace). At frame 0 the `mmatrix`
matrix is recalled first. Note `mset` wipes all `mdo` commands.

**Examples**
```
mdo 1, turn y, 1
```

**Related.** [mappend](#mappend), [mset](#mset).

**Source.** `packages/engine/modules/pymol/moving.py:274`; C `MovieSetCommand`
`packages/engine/layer1/Movie.cpp:1074`. Engine-ts soft stub.

---

## mappend

**Purpose.** Append an extra command string to a frame's existing movie command.

**Syntax.** `mappend(frame, command)`.

**Behaviour.** `_cmd.mdo(COb, frame-1, ";"+command, 1)` (append).

**Source.** `packages/engine/modules/pymol/moving.py:323`;
`packages/engine-ts/src/cmd/system.ts:183`.

---

## mdump

**Purpose.** Print all defined movie commands to the feedback stream.

**Syntax.** `mdump()`.

**Behaviour.** Prints `"%5d: %s"` per frame. There is no structured getter upstream.

**Source.** `packages/engine/modules/pymol/moving.py:81`; C `MovieDump`
`packages/engine/layer1/Movie.cpp:378`. Engine-ts stub (`() => null`).

---

## mmatrix

**Purpose.** Store/recall the camera matrix applied at the first frame of the movie.

**Syntax.** `mmatrix(action)` — action one of `clear | store | recall | check`.

**Behaviour.** Maps to `_cmd.mmatrix(0..3)`. Do not mix with `mview` (the docstring warns
they compete for the frame-0 camera).

**Source.** `packages/engine/modules/pymol/moving.py:772`; C `MovieMatrix`
`packages/engine/layer1/Movie.cpp:589`; `packages/engine-ts/src/cmd/movie2.ts:254`.

---

## mview

**Purpose.** Store and interpolate camera / per-object key frames — the core of PyMOL's
key-frame animation. Reach for it to build smooth camera fly-throughs and object motions.

**Syntax**

`mview(action='store', first=0, last=0, power=0.0, bias=-1.0, simple=-1, linear=0.0,
object='', wrap=-1, hand=0, window=5, cycles=1, scene='', cut=0.5, quiet=1, auto=-1,
state=0, freeze=0)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `action` | str | `'store'` | `store, clear, reset, purge, interpolate, uninterpolate, reinterpolate, toggle, toggle_interp, smooth` |
| `first` | int | `0` | frame number, 0 = current frame |
| `last` | int | `0` | last frame of the range |
| `power` | float | `0.0` | ease at the key frame (0.0) vs. constant speed (1.0) |
| `bias` | float | `-1.0` | asymmetry of the ease in/out |
| `simple` | int | `-1` | simple (great-circle) vs. full interpolation |
| `linear` | float | `0.0` | blend toward straight-line camera motion |
| `object` | str | `''` | object for object key frames; empty = global camera |
| `wrap` | int | `-1` | wrap interpolation across the loop point |
| `hand` | int | `0` | handedness of the rotation path |
| `window` | int | `5` | smoothing window (for `smooth`) |
| `cycles` | int | `1` | smoothing passes |
| `scene` | str | `''` | store this scene name with the key frame |
| `cut` | float | `0.5` | scene-switch moment within the transition (0..1) |
| `quiet` | int | `1` | |
| `auto` | int | `-1` | auto-reinterpolate; -1 = use `movie_auto_interpolate` |
| `state` | int | `0` | if >0, store the object state with the key frame |
| `freeze` | int | `0` | never auto-reinterpolate |

**Behaviour.** `power` controls easing: `0.0` slows to a stop at each key frame, `1.0`
keeps constant speed; `linear` blends toward straight-line camera travel. Negative
`first`/`last` count back from `count_frames()`. A non-empty `scene` recalls that scene
*before* storing. Unless `freeze`, store/clear/toggle are followed by an automatic
`reinterpolate` when `auto>0` or `movie_auto_interpolate` is set. A key frame
(`CViewElem`) holds the 4×4 matrix, pre/post translation, clip planes, ortho flag, optional
state, `power`/`bias`, a `scene_name` and `specification_level` (2 = key frame,
1 = interpolated).

**Examples**
```
mview store, 1
mview store, 60, scene=F1
mview reinterpolate
```

**Related.** [mset](#mset), [scene](#scene), [get_view](#get_view).

**Source.** `packages/engine/modules/pymol/moving.py:160`; C `MovieView`
`packages/engine/layer1/Movie.cpp:1155`; `packages/engine-ts/src/cmd/movie2.ts:201`.

---

## frame-range-editing

**Purpose.** Move, copy, insert or delete whole frames (key frames + movie commands) in the
timeline — the surgery verbs behind the movie panel's drag gestures.

**Syntax**

| Command | Signature | mmodify action |
|---|---|---|
| `mmove` | `mmove(target, source=0, count=-1, freeze=0, object='', quiet=1)` | 2 |
| `mcopy` | `mcopy(target, source=0, count=-1, freeze=0, object='', quiet=1)` | 3 |
| `minsert` | `minsert(count, frame=0, freeze=0, object='', quiet=1)` | 1 |
| `mdelete` | `mdelete(count=-1, frame=0, freeze=0, object='', quiet=1)` | -1 |

**Behaviour.** All funnel into `_cmd.mmodify`. `source`/`frame` of 0 means "current frame"
(`get_frame()-1`); a negative `count` counts back from the end, and in `mdelete` `count<0`
means "to the end". An empty `object` targets the global camera row.

**Related.** [mview](#mview), [mset](#mset).

**Source.** `packages/engine/modules/pymol/moving.py:493` (mmove), `:545` (mcopy),
`:591` (mdelete), `:640` (minsert); C `MovieViewModify`
`packages/engine/layer1/Movie.cpp:89`. Engine-ts soft stubs.

---

## mplay

**Purpose.** Start playing the movie.

**Syntax.** `mplay()`.

**Behaviour.** `MoviePlay(G, cMoviePlay)`. When not looping and already at the last frame,
it rewinds first via `SceneSetFrame(G, 7, 0)`. Playback is paced by the backend
`SceneIdle` loop at `movie_fps`.

**Source.** `packages/engine/modules/pymol/moving.py` (mplay); C
`packages/engine/layer1/Movie.cpp:555`; `packages/engine-ts/src/cmd/system.ts:195`.

---

## mstop

**Purpose.** Stop movie playback.

**Syntax.** `mstop()`.

**Behaviour.** `MoviePlay(G, cMovieStop)`.

**Source.** `packages/engine/modules/pymol/moving.py`;
`packages/engine-ts/src/cmd/system.ts:199`.

---

## mtoggle

**Purpose.** Toggle movie playback (default Spacebar / End key).

**Syntax.** `mtoggle()`.

**Behaviour.** `MoviePlay(G, cMovieToggle)`.

**Source.** `packages/engine/modules/pymol/moving.py`;
`packages/engine-ts/src/cmd/system.ts:203`.

---

## mclear

**Purpose.** Clear the cached rendered frame images.

**Syntax.** `mclear()`.

**Behaviour.** `MovieClearImages`. Frees the frame cache built when `cache_frames` is on.

**Source.** `packages/engine/modules/pymol/moving.py:436`; C
`packages/engine/layer1/Movie.cpp:1432`; `packages/engine-ts/src/cmd/system.ts:186`.

---

## mpng

**Purpose.** Export the movie as a numbered series of PNG images (the raster export path).

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `prefix` | str | — | output filename prefix |
| `first` | int | `0` | starting frame (0 = first) |
| `last` | int | `0` | last frame (0 = last) |
| `preserve` | 0/1 | `0` | only write non-existing files |
| `modal` | int | `0` | render inside a modal draw loop |
| `mode` | int | `-1` | 2 = ray, 1 = draw, 0 = normal, -1 = check `ray_trace_frames`/`draw_frames` |
| `quiet` | int | `1` | |
| `width` | int | `0` | pixel width (0 = viewport) |
| `height` | int | `0` | pixel height (0 = viewport) |

**Behaviour.** `mode` asserts to `(-1,0,1,2)`. Unless ray mode, it routes through the
offscreen GL context. C side `MoviePNG` drives the modal `MovieModalPNG` loop. Higher-level
`movie.produce` wraps `mpng` plus ffmpeg/convert/mpeg_encode.

**Examples**
```
mpng frame_, mode=2
```

**Related.** [movie-programs](#movie-programs).

**Source.** `packages/engine/modules/pymol/moving.py:366`; C
`packages/engine/layer1/Movie.cpp:819`. Engine-ts stub (`() => null`; no GL context).

---

## movie-programs

**Purpose.** The `pymol.movie` helper module — high-level generators (`movie.add_*`) that
program camera/state loops in one call. These are what the Movie ▸ Program menu emits.

**Syntax (key-frame generators)**

| Function | Signature |
|---|---|
| `movie.add_blank` | `(duration=12.0, start=0)` |
| `movie.add_roll` | `(duration=12.0, loop=1, axis='y', start=0)` |
| `movie.add_rock` | `(duration=8.0, angle=30.0, loop=1, axis='y', start=0)` |
| `movie.add_nutate` | `(duration=8.0, angle=30.0, spiral=0, loop=1, offset=0, phase=0, shift=π/2, start=0)` |
| `movie.add_state_loop` | `(factor=1, pause=2.0, first=-1, last=-1, loop=1, start=0)` |
| `movie.add_state_sweep` | `(factor=1, pause=2.0, first=-1, last=-1, loop=1, start=0)` |
| `movie.add_scenes` | `(names=None, pause=8.0, cut=0.0, loop=1, rock=-1, period=8.0, animate=-1, start=0)` |

**Behaviour.** `start=0` appends at `get_movie_length()+1`. `add_roll` lays 3 key frames
(0/⅓/⅔) with `power=1`; `add_rock` two key frames at ¼/¾ with `power=-1`; `add_nutate`
stores every frame and can `spiral` the amplitude in/out; `add_scenes` stores one key frame
per scene (`mview store …, scene=NAME`) with an optional inter-scene rock/nutate per
`sweep_mode` and a closing `interpolate`/`smooth`. Legacy `mdo`-based generators also exist
(`movie.roll`, `movie.rock`, `movie.sweep`, `movie.nutate`, `movie.zoom`, `movie.screw`).

**Examples**
```
python
from pymol import movie
movie.add_roll(8.0)
python end
```

**Related.** [movie.produce](#movie-produce), [mview](#mview), [rock](#rock).

**Source.** `packages/engine/modules/pymol/movie.py:268` ff; `docs/movies-scenes-states.md` §7.

---

## movie-produce

**Purpose.** Encode the movie to a video file (mp4/mov/webm/gif/mpg) or PNG series in one
call, autodetecting the encoder.

**Syntax.** `movie.produce(filename, mode='', first=0, last=0, preserve=0, encoder='',
quality=-1, quiet=1, width=0, height=0)`.

**Behaviour.** `mode` shortcut `normal|draw|ray` → `0|1|2`. Encoder autodetect from the
extension: `.mpeg/.mpg` → `mpeg_encode`, else `ffmpeg`, else `convert`. Renders frames via
`mpng` into a `<basename>.tmp` dir (deleted unless `preserve`), forces even dimensions and
`opaque_background`, then shells out. Sets `keep_alive` during the render.

**Examples**
```
python
cmd.movie.produce("out.mp4", mode="ray", quality=90)
python end
```

**Source.** `packages/engine/modules/pymol/movie.py:846`; `docs/movies-scenes-states.md` §7.3.

---

## scene

**Purpose.** Store and recall named scenes. A scene captures the camera view, object
activity, per-atom visibility and color, representations, the global frame index, an
optional text message, and a PNG thumbnail. The one entry point for all scene actions.

**Syntax**

`scene(key='auto', action='recall', message=None, view=1, color=1, active=1, rep=1,
frame=1, animate=-1, new_key=None, hand=1, quiet=1, sele='all')`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `key` | str | `'auto'` | scene name; `'new'`/`''` auto-generates; `'*'` = all |
| `action` | str | `'recall'` | `store, recall, clear, insert_before, insert_after, next, previous, start, update, rename, delete, order, sort, first, append` |
| `message` | str | `None` | text shown on recall |
| `view` | 0/1 | `1` | include/restore the camera view |
| `color` | 0/1 | `1` | include/restore atom colors |
| `active` | 0/1 | `1` | include/restore object enabled-state |
| `rep` | 0/1 | `1` | include/restore representations |
| `frame` | 0/1 | `1` | include/restore the frame index |
| `animate` | float | `-1` | transition seconds; -1 = `scene_animation_duration` |
| `new_key` | str | `None` | new name (for `rename`) |
| `hand` | 0/1 | `1` | camera handedness on recall |
| `quiet` | int | `1` | |
| `sele` | str | `'all'` | atoms whose color/rep are captured |

**Behaviour.** `key='auto'` + `action='recall'` becomes `next` (why bare `scene` advances).
Deprecated aliases: `clear`→`delete`, `append`/`update`→`store`. `next`/`previous` wrap only
when `scene_loop` is on (or `scene_current_name` is empty). Recall with an empty key blanks
the screen. Recall restores each captured facet ANDed with the stored `storemask`; the
camera animates over `animate` seconds. Storing grabs a 220×124 PNG thumbnail via the
offscreen GL context. Every action sets `scenes_changed`, the GUI-refresh signal.

**Examples**
```
scene F1, store
scene F1
scene F1, store, view=0, color=0
```

**Related.** [scene_order](#scene_order), [view](#view),
[scene_buttons](#scene_buttons), [get_scene_message](#get_scene_message).

**Source.** `packages/engine/modules/pymol/viewing.py:1034`; C `MovieSceneFunc`
`packages/engine/layer3/MovieScene.cpp:755`.

---

## scene_order

**Purpose.** Reorder the stored scenes.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `names` | str | — | space-separated list of scene names |
| `sort` | 0/1 | `0` | sort in natural order |
| `location` | str | `'current'` | `top | current | bottom` |
| `quiet` | int | `1` | |

**Behaviour.** Duplicate names or an invalid `location` raise. Fires `scenes_changed`.

**Source.** `packages/engine/modules/pymol/viewing.py:961`; C
`packages/engine/layer3/MovieScene.cpp:88`. Engine-ts soft stub.

---

## get_scene_list

**Purpose.** List scene names in display order.

**Syntax.** `get_scene_list()` → `list[str]`.

**Source.** `packages/engine/modules/pymol/viewing.py:919`.

---

## get_scene_message

**Purpose.** Read the text message stored with a scene.

**Syntax.** `get_scene_message(name)` → str.

**Related.** [set_scene_message](#set_scene_message).

**Source.** `packages/engine/modules/pymol/viewing.py:927`.

---

## set_scene_message

**Purpose.** Set the text message stored with a scene.

**Syntax.** `set_scene_message(name, message)`.

**Source.** `packages/engine/modules/pymol/viewing.py:931`.

---

## get_scene_thumbnail

**Purpose.** Fetch a scene's thumbnail as a PNG byte buffer (used as a preview in the scene
panel).

**Syntax.** `get_scene_thumbnail(name)` → PNG bytes.

**Behaviour.** Backed by `MovieSceneGetThumbnail`; the buffer is a 220×124 PNG captured at
store time.

**Source.** `packages/engine/modules/pymol/viewing.py:923`;
`packages/engine/layer3/MovieScene.cpp:225`.

---

## scene_buttons

**Purpose.** Setting: draw the in-viewport scene-button overlay (the clickable list of
scene names on the right edge of the scene block).

**Syntax.** setting `scene_buttons`; default `1` (global).

**Behaviour.** Gates `SceneDrawButtons`. Left-click recalls a scene; middle-click rapid-
browses; right-click opens the `scene_menu`; dragging reorders via `scene_order`.

**Source.** `packages/engine/layer1/Scene.cpp:3456` (gate), `:2885` (`SceneDrawButtons`);
`packages/engine/layer1/SettingInfo.h:699`.

---

## scene_animation_duration

**Purpose.** Setting: seconds of camera animation when recalling a scene.

**Syntax.** setting `scene_animation_duration`; default `2.25` (global).

**Behaviour.** Used when `scene(...animate=-1)` and `scene_animation` resolves to "animate".
`scene_animation` (-1 falls back to the global `animation` setting; 0 disables).

**Related.** [animation_duration](#animation_duration), [scene](#scene).

**Source.** `packages/engine/layer1/SettingInfo.h:506`; resolver
`packages/engine/layer3/MovieScene.cpp:429`.

---

## animation_duration

**Purpose.** Setting: default seconds for camera animations (`zoom`/`orient`/`view` when
`animate=-1`).

**Syntax.** setting `animation_duration`; default `0.75` (global). Gated by `animation`
(default `1`).

**Source.** `packages/engine/layer1/SettingInfo.h:484`.

---

## scene-fkeys

**Purpose.** F-key binding of scenes: F1–F12 recall/store scenes; PgUp/PgDn step
previous/next.

**Behaviour.** Bare F1–F12 have no hard default; `_special` first honors explicit `set_key`
maps, then tries `cmd.scene` against `get_scene_list()`, then `cmd.view` against the view
dictionary. `Ctrl-F1..F12` store scenes named `F1..F12`; `PgUp`/`PgDn` →
`scene action=previous/next`; `Ctrl-PgUp/PgDn` → `scene new, insert_before/after`.

**Related.** [scene](#scene), [view](#view).

**Source.** `packages/engine/modules/pymol/shortcut_dict.py`;
`packages/engine/modules/pymol/internal.py:447` `_special`.

---

## set_state

**Purpose.** Set the current display state. Note there is **no dedicated `cmd.set_state`
command** — you set state through the movie frame or the `state` setting.

**Behaviour.** Use `cmd.frame(n)` / `cmd.set_frame(n)` to move the global cursor (states map
1:1 to frames without a movie), or `cmd.set("state", n, object)` to pin one object's state.
The clicked column of the sequence viewer in state mode also sets an object's `state`
setting.

**Related.** [get_state](#get_state), [set_frame](#set_frame), [state-vs-frame](#state-vs-frame).

**Source.** `packages/engine/modules/pymol/moving.py:958` (get_state); `state` setting
`packages/engine/layer1/SettingInfo.h:278`.

---

## split_states

**Purpose.** Separate a multi-state object into a set of single-state objects.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `object` | str | — | source object |
| `first` | int | `1` | first state |
| `last` | int | `0` | last state (0 = all) |
| `prefix` | str | `None` | output name prefix |

**Examples**
```
split_states nmr_ensemble, prefix=model_
```

**Related.** [join_states](#join_states).

**Source.** `packages/engine/modules/pymol/editing.py:175`; engine-ts implemented.

---

## join_states

**Purpose.** The reverse of `split_states` — build one multi-state object from a selection
spanning several objects.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `name` | str | — | object to create/modify |
| `selection` | str | `'all'` | atoms to include |
| `mode` | int | `2` | how to match atoms across states |
| `zoom` | int | `0` | |
| `quiet` | int | `1` | |

**Behaviour.** `mode` 0 = by atom identifiers, 1 = by atom order, 2 = by exact match.

**Source.** `packages/engine/modules/pymol/creating.py:1145`; engine-ts implemented.

---

## delete_states

**Purpose.** Delete specific states from an object.

**Syntax.** `delete_states(name, states)` — `states` a space-separated list of numbers or
ranges.

**Source.** `packages/engine/modules/pymol/commanding.py:548`; engine-ts implemented.

---

## set_state_order

**Purpose.** API-only: reorder an object's states.

**Syntax.** `set_state_order(name, order, quiet=1)` — `order` a 1-based permutation list.

**Source.** `packages/engine/modules/pymol/editing.py:350`; engine-ts implemented.

---

## all_states

**Purpose.** Setting: overlay every state of an object at once instead of showing one.

**Syntax.** setting `all_states`; default `0` (object scope).

**Behaviour.** Toggled by Movie ▸ Show All States. With it on, the whole ensemble draws
superimposed regardless of the current frame.

**Related.** [static_singletons](#static_singletons).

**Source.** `packages/engine/layer1/SettingInfo.h:133`.

---

## static_singletons

**Purpose.** Setting: keep single-state objects visible in every movie frame.

**Syntax.** setting `static_singletons`; default `1` (object scope).

**Behaviour.** A one-state object stays shown across all frames of a multi-state movie (Movie
▸ Static Singletons).

**Source.** `packages/engine/layer1/SettingInfo.h:166`.

---

## get_view

**Purpose.** Return (and optionally print) the current camera view as 18 floats suitable for
`set_view`.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `output` | int | `1` | 0 = print, 1 = return only, 2 = force print while logging, 3 = return a `set_view (...)` string |
| `quiet` | int | `1` | |

**Behaviour.** `_cmd.get_view` returns 25 floats; Python slices to 18: the column-major 3×3
model→camera rotation (0–8), origin in camera space (9–11), origin in model space (12–14),
front/rear clip (15–16) and the ortho flag / field-of-view (17). The camera looks down −Z.

**Examples**
```
get_view
```

**Related.** [set_view](#set_view), [view](#view).

**Source.** `packages/engine/modules/pymol/viewing.py:634`.

---

## set_view

**Purpose.** Set the camera from an 18-float view vector.

**Syntax.** `set_view(view, animate=0, quiet=1, hand=1)`.

**Behaviour.** Accepts a string (parsed by `safe_list_eval`) or a sequence; **must be exactly
18 floats** or it raises. `animate>0` interpolates the transition.

**Examples**
```
set_view (\
  1,0,0, 0,1,0, 0,0,1,\
  0,0,-40, 0,0,0, 20,60,-20 )
```

**Source.** `packages/engine/modules/pymol/viewing.py:734`.

---

## view

**Purpose.** Save and restore named camera views (view-only, unlike scenes). A pure-Python
dictionary keyed by name.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `key` | str | — | view name; `'*'` lists/clears all |
| `action` | str | `'recall'` | `store | recall | clear` |
| `animate` | float | `-1` | transition seconds |

**Behaviour.** Stored in `pymol._view_dict`; saved into sessions. F1–F12 fall back to views
when no scene of that name exists.

**Examples**
```
view v1, store
view v1
```

**Related.** [scene](#scene), [get_view](#get_view).

**Source.** `packages/engine/modules/pymol/viewing.py:783`.

---

## look_at

**Purpose.** Rotate an object (or the camera) so its forward (+Z) axis faces the center of a
target object.

**Syntax.** `look_at(target_obj, mobile_obj='_Camera')`.

**Behaviour.** With the default `_Camera` it reorients the view toward the target's center.

**Source.** `packages/engine/modules/pymol/viewing.py`; engine-ts implemented
(`packages/engine-ts/src/cmd/extras.ts`).

---

## turn

**Purpose.** Rotate the camera about a primary axis, centered on the origin (a camera-only
operation — coordinates are untouched).

**Syntax.** `turn(axis, angle)` — `axis` ∈ `x|y|z`, `angle` in degrees.

**Examples**
```
turn y, 90
```

**Related.** [move](#move), [rotate](#rotate), [rock](#rock).

**Source.** `packages/engine/modules/pymol/viewing.py:1300`.

---

## move

**Purpose.** Translate the camera along a primary axis (camera-only).

**Syntax.** `move(axis, distance)` — `axis` ∈ `x|y|z`.

**Source.** `packages/engine/modules/pymol/viewing.py:352`; engine-ts implemented.

---

## rotate

**Purpose.** Rotate atomic coordinates about an axis (or, with `object=`, an object/state
matrix). The coordinate counterpart to `turn`.

**Syntax**

| Param | Type | Default | Meaning |
|---|---|---|---|
| `axis` | str/vec | `'x'` | axis name or vector |
| `angle` | float | `0.0` | degrees |
| `selection` | str | `'all'` | atoms to modify |
| `state` | int | `-1` | state (0 = all when `object` given) |
| `camera` | 0/1 | `1` | interpret axis in camera space |
| `object` | str | `None` | rotate this object's matrix instead |
| `origin` | vec | `None` | rotation origin |
| `object_mode` | int | `0` | |

**Related.** [turn](#turn), [translate](#translate).

**Source.** `packages/engine/modules/pymol/editing.py`; `packages/engine-ts/src/cmd/transforms.ts:177`.

---

## translate

**Purpose.** Translate atomic coordinates (or an object/state matrix with `object=`). The
coordinate counterpart to `move`.

**Syntax.** `translate(vector=[0,0,0], selection='all', state=-1, camera=1, object=None,
object_mode=0)`.

**Related.** [move](#move), [rotate](#rotate).

**Source.** `packages/engine/modules/pymol/editing.py`; `packages/engine-ts/src/cmd/transforms.ts:230`.

---

## camera-framing

**Purpose.** The framing verbs that reposition the camera to cover a selection:
`zoom`, `center`, `orient`, `reset`.

**Syntax**

| Command | Signature |
|---|---|
| `zoom` | `zoom(selection='all', buffer=0.0, state=0, complete=0, animate=0)` |
| `center` | `center(selection='all', state=0, origin=1, animate=0)` |
| `orient` | `orient(selection='(all)', state=0, animate=0)` |
| `reset` | `reset(object='')` |

**Behaviour.** `zoom` scales/translates to cover the selection; `orient` aligns the
selection's principal components with XYZ; `reset` restores identity rotation, sets the
origin to the center of mass and zooms to all (or, with an object name, resets that object's
matrix). `animate<0` = default duration, `0` = none, `>0` = seconds.

**Examples**
```
orient chain A, animate=1
zoom resn LIG, 5
```

**Source.** `packages/engine/modules/pymol/viewing.py:66` (zoom), `:134` (center),
`:310` (orient), `:1774` (reset); `packages/engine-ts/src/cmd/transforms.ts:246`.

---

## rock

**Purpose.** Toggle live camera rocking/rolling about the current sweep axis (a real-time
oscillation, not a stored movie).

**Syntax.** `rock(mode=-1)`.

**Behaviour.** `mode`: `-2` = query only, `-1` = toggle (default), `0` = off, `1` = on.
Turning on restarts the sweep timer. `SceneUpdateCameraRock` reads `sweep_mode`
(0 = Y rock, 1 = X, 2 = Z, 3 = nutate); `sweep_angle<=0` degenerates into a continuous
spin. Amplitude from `sweep_angle`, phase from `sweep_phase`, speed from `sweep_speed`, tick
rate from `rock_delay`. "Roll" is the movie equivalent — [movie.add_roll](#movie-programs).

**Examples**
```
rock
```

**Related.** [turn](#turn), [movie-programs](#movie-programs).

**Source.** `packages/engine/modules/pymol/viewing.py:1360`; C `ControlRock`
`packages/engine/layer1/Control.cpp:415`; `packages/engine-ts/src/cmd/movie2.ts:312`.

---

## sequence-viewer

**Purpose.** The in-viewport sequence viewer ("Seeker") — a text grid of residues/atoms per
object, where clicking cells builds and edits the active atom selection.

**Syntax.** Enabled per object by the `seq_view` setting (`set seq_view, 1`). Display mode
via `seq_view_format`: `0` one-letter residue codes, `1` three-letter names, `2` atom names,
`3` chain identifiers, `4` state names (`5` = movie frames is a declared no-op). Label mode
via `seq_view_label_mode` (default 2 = residue numbers on every row).

**Behaviour.** Left-click toggles a residue in the active selection; drag extends a range;
Shift-click extends; Ctrl-click also centers; middle-click browses/centers; right-click
opens the residue menu. Each interaction emits an equivalent `cmd.select(name, expr,
enable=1)`. Coloring follows `seq_view_color` (-1 = pick the guide/carbon/first atom color);
gaps follow `seq_view_gap_mode`; alignment mode lines rows up by tag when an alignment is
active. Placement is `seq_view_location` (0 top / 1 bottom), optionally `seq_view_overlay`.
The engine only writes the grid into `G->Seq->Row`; the structured per-cell payload for a
client is rebuilt from `cmd` queries by the bridge (`tenmol_seqview`).

**Examples**
```
set seq_view, 1
set seq_view_format, 1
```

**Related.** [state-vs-frame](#state-vs-frame).

**Source.** `packages/engine/layer3/Seeker.cpp:969` `SeekerUpdate`,
`packages/engine/layer1/Seq.cpp:259` `CSeq::draw`; `docs/movies-scenes-states.md` §12.

---

## seq_view

**Purpose.** Setting: show/hide the sequence viewer for an object.

**Syntax.** setting `seq_view`; default `0` (object scope).

**Related.** [sequence-viewer](#sequence-viewer), [seq_view_format](#seq_view_format).

**Source.** `packages/engine/layer1/SettingInfo.h:448`.

---

## seq_view_format

**Purpose.** Setting: sequence-viewer display mode.

**Syntax.** setting `seq_view_format`; default `0` (object scope). Values: 0 one-letter
codes, 1 three-letter names, 2 atom names, 3 chain identifiers, 4 state names.

**Behaviour.** For discrete objects, `seq_view_discrete_by_state` overrides the mode to 4
(state names).

**Source.** `packages/engine/layer1/SettingInfo.h:452`;
`packages/engine/layer3/Seeker.cpp:1016`.
