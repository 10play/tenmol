# @tenmol/viewport

The 3-D viewport: the canvas, **both** render modes, and mouse/wheel/resize
forwarding. Framework-free — `apps/web/src/features/viewport` is the React
binding, and nothing in here imports React.

```ts
import { createViewport, Rep } from '@tenmol/viewport';

const viewport = createViewport({ container, transport });
viewport.setRepMode(Rep.Sphere, 'geometry'); // per-rep Mode G, falls back by itself
```

## The two modes

| | Mode P | Mode G |
|---|---|---|
| who draws | PyMOL, into an offscreen FBO, with its own shaders | three.js, in the browser |
| what travels | encoded bitmaps (`PixelFrameHeader`) | PyMOL's own CPU-side buffers (`layer4/CmdWebGeometry.cpp`) |
| fidelity | 100 % by construction — volume, slice, labels, ray, every setting | the reps the accessor can express |
| default | **yes** | opt-in per rep |
| cost | 3.4 ms/frame at 1280x960 on 1AON (plan §1.3) | one upload per rep, then local |

They composite: Mode P blits to a 2-D canvas, Mode G draws into a transparent
WebGL2 canvas stacked on top, and both are clipped to PyMOL's **scene
rectangle** (`cmd.get_viewport()`), which is not always the whole window.

`renderPolicy.ts` resolves the per-rep toggle and records *why* a rep degraded
(`no-accessor`, `unsupported-rep`, `webgl-unavailable`, `extraction-failed`,
`preshader-disposed`, `payload-too-large`, `user-preference`). A rep asked for
in Mode G is never silently blank: it is either drawn client-side or drawn
server-side with a named reason.

## Layout

```
src/camera.ts        get_view() -> the two matrices PyMOL builds. THE only place
                     that knows the 18/25-float asymmetry (golden test).
src/resize.ts        ResizeObserver -> _reshape + display_scale_factor
src/surface.ts       the two canvases + the overlay
src/input/coords.ts  browser px -> PyMOL window coords (Y flip, dpr, truncation)
src/input/mouse.ts   pointer/wheel/pinch -> {t:'input'}, 1:1 and in order
src/modeP/           presenter (decode + blit) and the two frame sources
src/modeG/           three.js renderer, CGO/mesh/instance builders, ported shaders
src/renderPolicy.ts  the per-rep toggle and the automatic fallback
src/viewport.ts      createViewport() — the one component API
tools/pull_geometry.py  accessor -> wire frames (dev fixtures + bridge reference)
```

## Things that are easy to get wrong (all measured, not assumed)

* **`view[17] > 0` means ORTHOSCOPIC.** `SceneGetView` writes
  `ortho ? fov : -fov` (`layer1/Scene.cpp:902`), so PyMOL's default perspective
  camera reports `-20`. Reading the sign the other way renders Mode G ~3 %
  large — caught by comparing the two modes' silhouettes in a real browser
  (IoU 0.83 -> 0.96 after the fix).
* **`cmd.get_viewport()` != the window.** `OrthoReshape`
  (`layer1/Ortho.cpp:2383-2390`) subtracts `MovieGetPanelHeight()` and the
  internal feedback lines. Measured: a 1176x644 window reports 1176x629 as soon
  as an object has two states, because `movie_panel` is on. Mode P letterboxes
  into that rectangle (top-anchored — PyMOL's origin is bottom-left and the
  panel is at the bottom) and Mode G sets its GL viewport to match.
* **The Y flip happens in CSS pixels, before the dpr multiply**, and `int()`
  truncates (`modules/pmg_qt/pymol_gl_widget.py:169-176`).
* **Drags may be coalesced, never reordered.** Dropping an intermediate
  position is invisible to `SceneDrag`; reordering corrupts the backend's drag
  state. The pending drag is always flushed before a button event.
* **The wheel is a DOWN/UP pair** and is not sent at all while a button is
  held, because `OrthoButton` drops it (`layer1/Ortho.cpp:2503-2510`).
* **Spheres and cylinders are instanced impostors**, ports of
  `data/shaders/sphere.*` and `cylinder.*`, with `gl_FragDepth`. Client-side
  tessellation is what turned 1UBQ `mesh` into 31,710 cylinders in the
  exporters (spike 03 §4); it is not done here. Strips and fans ARE re-indexed
  to triangles, which is the same geometry, because three.js draws
  `GL_TRIANGLES` only.

## Mode-G fixtures

The C++ accessor has landed; the bridge-side producer has not. To drive Mode G
with real geometry:

```bash
bridge/.venv/bin/python packages/viewport/tools/pull_geometry.py \
    --pdb test/dat/1tii.pdb --out .tenmol/frames \
    --rep cartoon --rep sticks --rep spheres --rep surface

# then, with `pnpm dev` running:
open 'http://127.0.0.1:5173/?viewportFixtures=m.cartoon.bin&viewportModeP=off'
```

`tools/pull_geometry.py` is also the executable reference for the bridge
producer: it shows the two places a naive accessor -> wire mapping goes wrong
(draw-arrays sub-arrays must be concatenated in `layer1/CGO.cpp:1650-1671`
order; the pick slot is not shipped).

## Tests

```bash
pnpm --filter @tenmol/viewport test
TENMOL_GEOMETRY_FIXTURES=<dir> pnpm --filter @tenmol/viewport test  # + real frames
```
