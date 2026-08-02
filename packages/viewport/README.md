# @tenmol/viewport

The 3-D viewport: the canvases, **both** render modes, input forwarding,
client-side picking, and the compositor that decides which renderer owns which
rep. Framework-free — `apps/web/src/features/viewport` is the React binding, and
nothing in here imports React.

```ts
import { createViewport, Rep } from '@tenmol/viewport';

const viewport = createViewport({ container, transport });
viewport.setRepMode(Rep.Sphere, 'geometry'); // per-rep Mode G, falls back by itself
```

## The two modes

|              | Mode P                                                     | Mode G                                                                     |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| who draws    | PyMOL, into an offscreen FBO, with its own shaders         | three.js, in the browser                                                   |
| what travels | encoded bitmaps (`PixelFrameHeader`)                       | PyMOL's own CPU-side buffers (`packages/engine/layer4/CmdWebGeometry.cpp`) |
| fidelity     | 100 % by construction — volume, labels, ray, every setting | the reps the accessor can express (18 of 21)                               |
| default      | **yes**                                                    | opt-in per rep                                                             |
| cost         | 3.4 ms/frame at 1280x960 on 1AON                           | one upload per rep, then local                                             |

They composite: Mode P blits to a 2-D canvas, Mode G draws into a transparent
WebGL2 canvas stacked on top (which is also the pointer target, because it is
topmost), and both are clipped to PyMOL's **scene rectangle**
(`cmd.get_viewport()`), which is not always the whole window.

`renderPolicy.ts` resolves the per-rep toggle and records _why_ a rep degraded —
`no-accessor`, `unsupported-rep`, `webgl-unavailable`, `extraction-failed`,
`preshader-disposed`, `payload-too-large`, `user-preference`. Degradations are
sticky per rep so a failed rep does not thrash between modes frame by frame. A
rep asked for in Mode G is never silently blank: it is either drawn client-side
or drawn server-side with a named reason.

## Layout

Subpath exports: `.` `./input` `./modeP` `./modeG` `./stream` `./webgl`
`./picking` `./materials` `./compositor`.

```
src/viewport.ts     createViewport() — the one component API
src/camera.ts       get_view() -> the matrices PyMOL builds. THE only place that
                    knows the 18/25-float asymmetry (golden test)
src/surface.ts      the two canvases + the pointer-transparent overlay
src/resize.ts       ResizeObserver -> _reshape + display_scale_factor
src/renderPolicy.ts the per-rep toggle and the automatic fallback
src/transport.ts    bindConnection() — the @tenmol/client seam
src/input/          coords, mouse/pinch/wheel, the clock-driven drag coalescer,
                    the ButMode table + mode_dict mirror, key translation,
                    shortcuts, and the RPC camera driver for a GL-free backend
src/modeP/          presenter (decode + blit) and the two frame sources
src/modeG/          three.js renderer, the geometry cache, the invalidation
                    poller, the frame sources, impostor materials
src/webgl/          the geometry builder: indexed mesh, instanced draws, and the
                    quad-expanded wide lines
src/shaders/        GLSL ported from packages/engine/data/shaders
src/picking/        screen ray, the pick index built from Mode-G buffers, and
                    the pick-route registry
src/compositor/     who draws what: the declaration/authority split
src/stream/         pause and visibility control (per-client, not per-process)
tools/pull_geometry.py  accessor -> wire frames, for dev fixtures
```

## Things that are easy to get wrong (all measured, not assumed)

- **`view[17] > 0` means ORTHOSCOPIC.** `SceneGetView` writes `ortho ? fov : -fov`
  (`packages/engine/layer1/Scene.cpp:902`), so PyMOL's default _perspective_
  camera reports `-20`. Reading the sign the other way renders Mode G ~3 %
  large — caught by comparing the two modes' silhouettes in a real browser
  (IoU 0.83 -> 0.96 after the fix).
- **`cmd.get_viewport()` != the window.** `OrthoReshape`
  (`packages/engine/layer1/Ortho.cpp:2383-2390`) subtracts `MovieGetPanelHeight()`
  and the internal feedback lines. Measured: a 1176x644 window reports 1176x629
  as soon as an object has two states, because `movie_panel` is on. Mode P
  letterboxes into that rectangle (top-anchored — PyMOL's origin is bottom-left
  and the panel is at the bottom) and Mode G sets its GL viewport to match.
- **The Y flip happens in CSS pixels, before the dpr multiply**, and `int()`
  truncates (`packages/engine/modules/pmg_qt/pymol_gl_widget.py:169-176`).
- **Drags may be coalesced, never reordered.** Dropping an intermediate position
  is invisible to `SceneDrag`; reordering corrupts the backend's drag state. The
  pending drag is flushed before any button event. The coalescer is driven by a
  **clock, not `requestAnimationFrame`** — rAF stops dead in a hidden or
  occluded tab, and the rAF version turned a whole 60-sample drag into one jump
  at `pointerup`.
- **The wheel is a DOWN/UP pair** and is not sent at all while a button is held,
  because `OrthoButton` drops it (`packages/engine/layer1/Ortho.cpp:2503-2510`).
- **Spheres and cylinders are instanced impostors**, ports of
  `packages/engine/data/shaders/sphere.*` and `cylinder.*`, writing
  `gl_FragDepth`. Client-side tessellation is what turned 1UBQ `mesh` into
  31,710 cylinders in PyMOL's exporters; it is not done here. Strips and fans
  ARE re-indexed to triangles — the same geometry — because three.js draws
  `GL_TRIANGLES` only.
- **Lines are quads, and their width is a camera quantity.** WebGL2 core clamps
  `gl.lineWidth` to 1.0 (measured `ALIASED_LINE_WIDTH_RANGE == [1,1]` in the
  headless Chromium the e2e suite uses), so `mesh_width` would be inert. Each
  segment becomes a screen-space quad, exactly as PyMOL's own `trilines` path
  does. The rasterised width is
  `clamp(dynamic_width_factor / vertex_scale, min, max) * mesh_width` and
  `vertex_scale` depends on the projection — so it **cannot** be baked into a
  cached geometry frame and is recomputed in `onBeforeRender` every draw.
- **Picking reproduces two backend conventions or it disagrees with Mode P**:
  the cRange=7 outward square-ring scan, and — for a triangle mesh — the atom of
  the _last_ index of the hit triangle, because the pick pass is flat-shaded and
  GL's default provoking vertex is the last one. Taking the nearest barycentric
  corner scores 10/15 against a real GL pick; the provoking vertex scores 15/15.
- **A pick has a routing table, not a hard-coded destination.** Features call
  `registerPickRoute()` from `@tenmol/viewport/picking`; routes are consulted
  most-recently-registered first and a route that returns `true` consumes the
  pick, suppressing the default `select('sele', ...)`. That is how the Builder
  gets clicks in editing mode without this package importing the app.
- **A rep is drawn by exactly one renderer, and the bridge decides which.**
  `src/compositor/` splits this into an advisory client -> bridge _declaration_
  ("these are the reps I can draw") and an authoritative bridge -> client answer
  (`PixelFrameHeader.reps`, "these reps are IN this bitmap"). Assuming your own
  declaration took effect is the bug that double-drew every Mode-G rep.

## Mode-G fixtures

The bridge serves real Mode-G frames now, so fixtures are only needed to work on
the decoder/renderer without a bridge:

```bash
packages/bridge/.venv/bin/python packages/viewport/tools/pull_geometry.py \
    --pdb packages/engine/test/dat/1tii.pdb --out /tmp/tenmol-frames \
    --rep cartoon --rep sticks --rep spheres --rep surface

# then, with `pnpm dev` running:
open 'http://127.0.0.1:5173/?viewportFixtures=m.cartoon.bin&viewportModeP=off'
```

The dev query switches live in `apps/web/src/features/viewport/devFixtures.ts`:
`?viewportFixtures=`, `?viewportHandle=1` (publishes the live `ViewportHandle`
on `window.__tenmolViewport` — what the e2e suite measures), `?viewportPull=off`
and `?viewportModeP=off`. All are inert in a production build.

## Tests

```bash
$ pnpm --filter @tenmol/viewport test
 Test Files  31 passed (31)
      Tests  378 passed | 1 skipped (379)

TENMOL_GEOMETRY_FIXTURES=<dir> pnpm --filter @tenmol/viewport test  # + real frames
```

The skipped test is the real-accessor fixture suite; it is skipped rather than
faked when `TENMOL_GEOMETRY_FIXTURES` is unset. Tests live next to the code they
cover (`src/**/*.test.ts`) plus five broader suites in `test/`; a file named
`*.dom.test.ts` runs under jsdom, everything else under node.
