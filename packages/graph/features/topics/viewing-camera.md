---
name: viewing-camera
kind: feature
category: viewing-camera
subcategory: camera & global viewing control
summary: PyMOL's global camera and scene-viewing verbs — framing (zoom/orient/center/origin/reset), camera motion (turn/move/rotate/translate/clip/look_at), the 18-float view vector (get_view/set_view/view), viewport/window/full-screen/stereo control, live rocking, background colour, the redraw verbs (dirty/rebuild/refresh), and the global display settings (field of view, perspective, fog/depth-cue, the ambient/direct/specular light rig, ray-interior colour) that shape the whole scene.
parity: implemented
---

## Purpose

These are the verbs and knobs that move the *camera* and shape the *whole scene*, as opposed to
per-object representations. Reach for them to frame a selection (`zoom`, `orient`, `center`,
`reset`), spin or dolly the camera (`turn`, `move`, `rotate`, `translate`, `clip`, `look_at`),
capture or restore an exact viewpoint (`get_view`/`set_view`/`view`), size the drawing surface
(`viewport`, `window`, `full_screen`, `stereo`), set the backdrop (`bg_color`), toggle live rocking
(`rock`), or force a redraw (`dirty`, `rebuild`, `refresh`). A second group are global settings —
`field_of_view`, `orthoscopic`, `depth_cue`/`fog`, the `ambient`/`direct`/`specular` light rig,
`ray_interior_color` — that alter how every object is lit and projected.

## Syntax

The camera state is a single **18-float view vector** (see [get_view](#get_view)): a column-major
3x3 model->camera rotation (0-8), the rotation origin in camera space (9-11) and model space
(12-14), the front/rear clipping-plane distances (15-16), and a combined orthoscopic-flag /
field-of-view value (17). Every framing and motion verb below ultimately edits this vector. The
camera looks down -Z with +X to the left and +Y down; in the default view model +X is to the
observer's right, +Y up, +Z toward the observer. See each section for exact signatures.

Most framing verbs take an `animate` argument: `animate < 0` uses the default animation duration,
`animate = 0` snaps instantly, `animate > 0` interpolates over that many seconds.

---

## zoom

`zoom` scales and translates the window and the origin to cover an atom selection, guessing an
optimal level that balances closeness against occasional clipping.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `"all"` | selection-expression or name pattern to frame |
| `buffer` | float | `0.0` | extra padding distance in Å |
| `state` | int | `0` | `0` = all states, `-1` = current state, `>0` = that state |
| `complete` | 0/1 | `0` | `1` guarantees no atom centre is clipped out of an orthoscopic view |
| `animate` | float | `0` | `<0` default duration, `0` none, `>0` seconds |

To absolutely prevent clipping of graphical representations that extend past atom centres, add a
`buffer` (typically ~2 Å) on top of `complete=1`.

## orient

`orient` aligns the principal components of the selected atoms with the XYZ axes (like X-PLOR's
`orient`), then frames them. Signature: `orient(selection="(all)", state=0, animate=0)`. Good for
getting a reproducible "best" side-on view of an elongated molecule.

## center

`center` translates the window, the clipping slab, and the origin to a point centred within the
selection. Signature: `center(selection="all", state=0, origin=1, animate=0)`. With `origin=0` the
rotation origin is left unchanged (only the view is shifted); with `origin=1` (default) the pivot
moves to the selection centroid.

## origin

`origin` sets the centre of rotation about a selection without changing what is framed. Signature:
`origin(selection="(all)", object=None, position=None, state=0)`. A `position=[x,y,z]` argument
overrides the selection and sets an explicit pivot. If an `object` name is given, the pivot is
stored for that object for use in animation/editing.

## reset

`reset` restores the rotation matrix to identity, sets the origin to the (approximate) centre of
mass, and zooms the window and clipping planes to cover all objects. Signature: `reset(object='')`.
Given an `object` name it instead resets that object's transformation matrix.

## turn

`turn` rotates the *camera* about one of the three primary axes, centred at the origin. Signature:
`turn(axis, angle)` — `axis` is `x`, `y`, or `z`; `angle` is in degrees. Contrast with `rotate`,
which moves object coordinates rather than the camera.

## move

`move` translates the *camera* along one of the three primary axes. Signature:
`move(axis, distance)`. A `z` move dollies the camera and carries the clipping planes with it (front
and rear distances shift by the same amount so the slab stays put relative to the model).

## rotate

`rotate` rotates the atomic *coordinates* of a selection about an axis — or, with an `object` name,
modifies that object's matrix rather than the camera.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `axis` | string/list | `'x'` | axis name `x`/`y`/`z` or a 3-vector |
| `angle` | float | `0.0` | degrees of rotation |
| `selection` | string | `"all"` | atoms whose coordinates are modified |
| `state` | int | `-1` | `0` = all states, `-1` = current, `>0` = that state |
| `camera` | 0/1 | `1` | `1` interprets the axis in camera space |
| `object` | string | `None` | object name (rotate its matrix instead of coords) |
| `origin` | list | `None` | explicit pivot; defaults to the view origin |
| `object_mode` | int | `0` | how the object matrix is combined |

With `camera=1` (default) the axis is given in camera space and mapped into model space via the
inverse of the model->camera rotation; the camera (`get_view`) is left unchanged.

## translate

`translate` shifts the atomic *coordinates* of a selection — or, with an `object` name, modifies
that object's matrix. Signature:
`translate(vector=[0.0,0.0,0.0], selection="all", state=-1, camera=1, object=None, object_mode=0)`.
With `camera=1` (default) the vector is in camera space and mapped to model space; `move` is the
camera-translation counterpart.

## clip

`clip` alters the positions of the near/far clipping planes. Signature:
`clip(mode, distance, selection=None, state=0)`.

| `mode` | Effect |
| --- | --- |
| `near` | move the near plane by `distance` (negative moves it away from you) |
| `far` | move the far plane by `distance` |
| `move` | move the whole slab by `distance` |
| `slab` | set the slab thickness to `distance` |
| `atoms` | clip a `distance`-Å slab about the current camera positions of `selection` |

Full mode set (including internal): `near, far, move, slab, atoms, near_set, far_set`.
`get_clip()` returns the current plane positions.

## look_at

`look_at` modifies a rotation of an object (or the view) so its forward (z) axis faces the centre of
a target object. Signature: `look_at(target_obj, mobile_obj='_Camera')`. With the default
`mobile_obj='_Camera'` it aims the camera at `target_obj`.

## get_view

`get_view` returns (and optionally prints) the current 18-float view vector in a form that can be
pasted into a script and fed to `set_view`. Signature: `get_view(output=1, quiet=1)`.

| `output` | Behaviour |
| --- | --- |
| `0` | print the matrix to screen |
| `1` | do not print (default) |
| `2` | force print even while a log file is open |
| `3` | return a formatted `set_view (...)` string instead of a list |

Internally `_cmd.get_view` returns 25 floats; the Python layer slices them to the 18 that
`set_view` consumes. When logging is active the matrix is written to the log file.

## set_view

`set_view` sets the full viewing state — rotation matrix, camera/model origins, clipping planes and
the orthoscopic flag — from an 18-float sequence (or a string parsed by `safe_list_eval`).
Signature: `set_view(view, animate=0, quiet=1, hand=1)`. The argument **must be exactly 18 floats**
or it raises `"bad view argument; should be a sequence of 18 floats"`. `animate>0` interpolates to
the new view over that many seconds.

## view

`view` saves and restores named camera views in a pure-Python dictionary (`pymol._view_dict`).
Signature: `view(key, action='recall', animate=-1)` with `action` one of `store`, `recall`, `clear`.
`key='*'` lists all stored views (or clears them with `action=clear`). Views F1-F12 are bound to the
function keys when no `set_key` override and no scene has claimed that key. Stored views persist in
session files.

## get_viewport

`get_viewport` returns (and optionally prints) the screen viewport size as `(width, height)`.
Signature: `get_viewport(output=1, quiet=1)`. `output` follows the same 0/1/2 convention as
`get_view`; `output==3` returns a deprecated string form.

## viewport

`viewport` changes the size of the graphics display area. Signature:
`viewport(width=-1, height=-1)`. Tuple/parenthesised syntax is deprecated (emits a warning).
Off the GUI thread the call is deferred through `cmd.do`.

## window

`window` controls the visibility and geometry of PyMOL's output window. Signature:
`window(action='show', x=0, y=0, width=0, height=0)`. `action` is one of the window verbs (show,
hide, position, size, box, ...). This is a GUI-shell operation routed to the Qt window when present.

## full_screen

`full_screen` enables or disables full-screen mode. Signature: `full_screen(toggle=-1)` — `-1`
toggles, or pass `on`/`off`. Must run on the GUI thread, otherwise it is deferred through `cmd.do`.
Behaviour varies by platform; the window maximise button is a reliable fallback.

## stereo

`stereo` activates or deactivates stereo display. Signature: `stereo(toggle='on', quiet=1)`.
`toggle` is one of `on, off, crosseye, walleye, quadbuffer, sidebyside, geowall, openvr`.
`quadbuffer` is the default when hardware stereo is available, otherwise `crosseye`.

## rock

`rock` toggles live Y-axis rocking of the camera (an interactive idle-loop animation, distinct from
movie key frames). Signature: `rock(mode=-1)`: `-1` toggles (default), `0` off, `1` on, and `-2`
queries the current `rock` setting without changing it. Turning it on restarts the sweep timer. The
actual motion honours the `sweep_mode` setting (Y/X/Z rock or nutate) and degenerates into a
continuous spin when `sweep_angle <= 0`. `ray` uses the `-2` query then `rock(0)` to stop rocking
before rendering.

## bg_color

`bg_color` sets the background colour. Signature: `bg_color(color="black")` where `color` is a
colour name or number. For a transparent background, `unset opaque_background` then `ray`. Stored as
a colour index (`bg_rgb`). British spelling `bg_colour` is an alias.

## dirty

`dirty` marks the scene as needing a redraw (an internal/legacy invalidation hook). No arguments.

## rebuild

`rebuild` forces PyMOL to recreate geometric objects that may have gone out of sync. Signature:
`rebuild(selection='all', representation='everything')`. Use it when a representation fails to update
after a change; `refresh` is the lighter-weight redraw.

## refresh

`refresh` causes the scene to be redrawn as soon as the operating system allows. No arguments. It is
lighter than `rebuild` (no geometry regeneration) — it just re-emits/redisplays the current scene.

---

## field_of_view

Global float (default `20.0`, range 1-179). The vertical field of view for the window, in degrees.
Larger values exaggerate perspective; it is only visible when perspective projection is on
(`orthoscopic` off). Stored in the view vector's slot 17 (as the abs value when > 1).

## orthoscopic

Global boolean (default `off`/`0`). When on, an orthographic (parallel) projection is used instead
of the perspective transform, removing depth foreshortening. The sign of view-vector slot 17 carries
this flag.

## depth_cue

Global boolean (default `on`/`1`). Master switch for the depth-cue fog effect that fades distant
geometry toward the background. When off, `fog`/`fog_start` have no effect.

## fog

Global float (default `1.0`, range 0-1). Controls the fog density used by the depth-cue effect
(requires `depth_cue` on). `0` = no fog, `1` = full density.

## fog_start

Global float (default `0.45`, range 0-1). Controls where the fog begins, as a fraction between the
near and far clipping planes; smaller values start fog closer to the camera.

## ray_interior_color

Per-object/state colour (default `-1`, meaning "use the object colour"). Sets the colour of surface
*interiors* (cut faces) seen in ray-traced images. The related `ray_interior_mode` (integer, default
`0`) governs how interior faces are generated.

## two_sided_lighting

Per-object/state integer (default `-1` = automatic; `on`/`off` when set explicitly). Controls
whether both faces of a triangle are lit or only the front face. Useful when the inside of a
surface or an open mesh appears black.

## ambient

Global float (default `0.14`, range 0-1). The uniform ambient lighting level applied to every
surface regardless of light direction. Raise it to lift shadows, lower it for higher contrast.

## direct

Global float (default `0.45`, range 0-1). The amount of light emitted from the camera direction
(a head-on key light that does not cast the movable-light shadows).

## reflect

Global float (default `0.45`, range 0-1). The aggregate intensity of the movable (directional) light
sources, as distinct from the camera light (`direct`) and the ambient term.

## specular

Global float (default `1.0`). The specular (highlight) intensity for the movable light sources.
`0` removes highlights; when `1.0`, `specular_intensity` sets the actual strength.

## specular_intensity

Global float (default `0.5`). The specular intensity for the movable light sources when `specular`
is `1.0`. The effective highlight brightness.

## shininess

Global float (default `55.0`). The specular exponent for the movable light sources — higher values
give smaller, tighter, glossier highlights.

## light_count

Global integer (default `2`, range 1-10). The number of light sources including the camera source
(so `1` = ambient/camera only, `2-10` add directed lights). Defines the size of the movable light
rig.

## spec_count

Global integer (default `-1`). How many movable light sources contribute specular reflections;
`-1` derives it from `light_count`.

## spec_power

Global float (default `-1.0`). The specularity power coefficient for the ray tracer; if `< 0` the
`shininess` value is used instead.

## spec_reflect

Global float (default `-1.0`). Specular intensity for the ray tracer; if `< 0` the
`specular_intensity` value is used instead.

## reflect_power

Global float (default `1.0`). The reflective exponent for the movable light sources (controls how
sharply their diffuse reflection falls off).

---

## Examples

```
# frame and orient a chain, then bank the camera and pull the near plane in
orient chain A, animate=1
turn y, 30
clip near, -5

# capture the exact viewpoint, restore it later
get_view                 # prints an 18-float set_view(...) block
view v1, store
view v1                  # recall with the default animation
```

```
# a soft, flat, fog-free look for a figure
bg_color white
set orthoscopic, on
set depth_cue, off
set ambient, 0.3
set specular, 0
zoom polymer, complete=1, buffer=2
```

```
# live rocking preview, then stop and ray-trace at a fixed size
viewport 1200, 900
rock 1
rock 0
ray 1200, 900
```

## Related

- [rendering-export](../topics/rendering-export.md) — `ray`, `draw`, `png` consume this camera/light state.
- [representations](../topics/representations.md) — per-object reps that the camera views.
- [movies-scenes-states](../topics/movies-scenes-states.md) — `scene`/`mview` store and interpolate the view vector; `bg_color` and lighting are captured by scenes.
- [coloring](../topics/coloring.md) — `bg_color` shares the colour machinery with `color`/`set_color`.

## Source

- Camera & view verbs: `packages/engine/modules/pymol/viewing.py` (zoom `:66`, center `:134`, clip `:181`, origin `:256`, orient `:310`, move `:352`, get_view `:634`, set_view `:734`, view `:783`, get_viewport `:853`, stereo `:1266`, turn `:1300`, full_screen `:1329`, rock `:1360`, window `:1431`, viewport `:1459`, bg_color `:1488`, refresh `:1750`, reset `:1774`, dirty `:1795`, rebuild `:1837`).
- `rotate`/`translate`/`look_at`: `packages/engine/modules/pymol/editing.py:2002`, `:1896`, `:2141`.
- Global display settings & defaults: `packages/engine/layer1/SettingInfo.h` (ambient `:91`, direct `:92`, reflect `:93`, orthoscopic `:107`, spec_reflect `:108`, spec_power `:109`, depth_cue `:168`, specular `:169`, shininess `:170`, fog `:172`, field_of_view `:237`, reflect_power `:238`, two_sided_lighting `:241`, fog_start `:277`, ray_interior_color `:325`, specular_intensity `:399`, light_count `:555`, ray_interior_mode `:576`, spec_count `:592`); help text `packages/engine/data/setting_help.csv`.
- Behaviour prose: `docs/movies-scenes-states.md` §9 (camera get/set, interpolate, turn/move/zoom/orient/clip, rock).
- Parity: camera verbs are covered by the TypeScript port (`packages/engine-ts/src/view/view.ts` ViewState with `turn`/`zoomToSphere`/`orientTo`; `packages/engine-ts/src/cmd/transforms.ts` for `rotate`/`move`/`translate`/`center`/`origin`/`clip`; `extras.ts` for `stereo`/`look_at`/`refresh`; `movie2.ts` for `rock`; `misc2.ts` for `dirty`; `display.ts` for `rebuild`) and the whole area is marked done (32/32) in `docs/feature-parity.md`. The ray-interior colour, fog-start and the finer ray specular knobs (`spec_count`/`spec_power`/`spec_reflect`/`reflect_power`) are stored but not yet honoured by the WebGL/CPU renderer.
