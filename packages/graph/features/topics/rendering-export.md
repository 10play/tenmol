---
name: rendering-export
kind: feature
category: rendering-export
subcategory: overview
summary: Every way PyMOL turns the current scene into pixels or geometry files — the built-in CPU ray tracer, the OpenGL draw path, PNG/movie-frame image writers, the focal-blur helper, and the COLLADA/glTF/IDTF/OBJ+MTL/VRML/POV-Ray/STL geometry exporters — plus the key ray_* and image settings that steer them.
parity: partial
---

# Rendering & Export

This domain covers image production and geometry export. Two rendering engines feed the pixel
pipeline: the interactive **OpenGL** path (`draw`) and the offline **CPU ray tracer** (`ray`,
`packages/engine/layer1/Ray.cpp`), a ~7800-line renderer with true shadows, analytic
per-primitive intersection, interior colours and `ray_trace_mode` cel-shading that has **no GL
equivalent** — the web client renders publication images by calling `ray` + `png` server-side and
displaying the bitmap (`docs/feature-parity.md:559`). Separately, a family of `get_*` commands walks
the same scene geometry and serialises it to interchange formats (COLLADA, glTF, IDTF, OBJ+MTL,
VRML, POV-Ray, STL) via `save`'s extension dispatch table (`exporting.py:988`).

The tenmol TypeScript engine ships its own headless CPU ray tracer
(`packages/engine-ts/src/render/`) wired to `ray`/`draw`/`png`, plus a dependency-free PNG encoder,
so a rendered frame round-trips as real PNG bytes with no OpenGL context (PR #27). The geometry
exporters remain thin C++/incentive stubs on the port side.

---

## ray

`ray(width=0, height=0, antialias=-1, angle=0.0, shift=0.0, renderer=-1, quiet=1, async_=0)` —
produces a ray-traced image of the current frame using the built-in CPU renderer. Slow (seconds to
minutes) but the only path to shadows, `ray_trace_mode` outlines, interior colours and antialiasing.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `width` | int | `0` | image width in px; `0` = current viewport |
| `height` | int | `0` | image height in px; `0` = current viewport |
| `antialias` | int | `-1` | `-1` uses the `antialias` setting; else 0–4 |
| `angle` | float | `0.0` | y-axis rotation for stereo-pair generation |
| `shift` | float | `0.0` | x-axis translation for stereo-pair generation |
| `renderer` | int | `-1` | `-1` default, `0` built-in, `1` PovRay, `2` dry-run/geometry-count |
| `quiet` | int | `1` | suppress console output |
| `async_` | int | `0` | render in a background thread (alias `async`) |

### Behaviour

If only one of `width`/`height` is given the other is scaled to preserve the current aspect ratio.
`ray` first stops any playing movie, turns off `sculpting`, and cancels rocking. `renderer=1`
shells out to a `povray` binary (Unix-only, via `tmp_pymol.pov`/`tmp_pymol.png`); `renderer=2` runs
a dry pass that only counts primitives. The image is held in memory until `png`/`draw` copies it out.
Ray output is steered by the `ray_*` settings below (`ray_shadow`, `ray_trace_mode`, `antialias`,
`ray_opaque_background`, `ambient_occlusion_mode`, …). The tenmol port's ray tracer honours
`shadows` (true for `ray`) and the resolved supersample factor; `ray_trace_mode` cel-shading has no
port path.

```
ray
ray 1024, 768
ray renderer=2
```

## draw

`draw(width=0, height=0, antialias=-1, quiet=1)` — creates an OpenGL raster of the current frame.
Fast (no shadows/ray effects), but requires a live GL context so it fails in command-line-only mode.
Aspect ratio is preserved when only one dimension is given. On some hardware
`unset opaque_background; draw` yields a transparent background, though `ray` gives better results.
In the tenmol port `draw` reuses the same CPU renderer as `ray` with shadows disabled.

```
draw
draw 1600
```

## png

`png(filename, width=0, height=0, dpi=-1.0, ray=0, quiet=1, prior=0, format=0)` — writes the current
display to a PNG file. PNG is the only image format PyMOL writes directly.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | — | output path; `.png` appended if missing |
| `width` | int/str | `0` | px, or `in`/`cm` string (needs `dpi`); `0` = current |
| `height` | int/str | `0` | see `width`; aspect preserved if one is omitted |
| `dpi` | float | `-1.0` | dots-per-inch; `<0` falls back to `image_dots_per_inch` |
| `ray` | 0/1 | `0` | run `ray` first (else use the GL/OpenGL frame) |
| `quiet` | int | `1` | suppress console output |
| `prior` | int | `0` | `1`/`-1` reuse the prior rendered image without re-rendering |
| `format` | int/str | `0` | `0`=PNG, `1`=PPM, `-1`=guess from extension (`.ppm`→PPM) |

### Behaviour

Width/height accept unit suffixes (`10cm`, `4in`) which are converted to pixels via
`_unit2px` using `dpi`; a bare number is pixels. `prior` fetches the last rendered image on a
fast, GLUT-thread-safe path (raises/falls back if none exists). When `ray=0` and no image is
cached, the port renders a fast draw-style raster on demand. The port encodes via a dependency-free
PNG encoder (`packages/engine-ts/src/render/png.ts`) and returns the bytes for browser download;
headless disk writes are no-ops.

```
png image.png
png image.png, dpi=300
png image.png, 10cm, dpi=300, ray=1
```

## get_image

Screen-capture accessor: returns the last rendered frame's raw RGBA buffer (length `w*h*4`). This is
the port's headless equivalent of grabbing the framebuffer — it is populated by `ray`/`draw`/`png`
and read back for display or PNG encoding. In upstream PyMOL the analogous screen capture is the
in-memory image consumed by `png` (including its `prior` fast path) and `copy_image`.

## copy_image

`copy_image(quiet=1)` — copies the current rendered image to the system clipboard. Marked an
"incentive feature / proprietary" in the source; it dispatches to `_copy_image` on the GUI thread.
No headless behaviour and no TypeScript port path.

## focal_blur

`focal_blur(aperture=2.0, samples=10, ray=0, filename='', quiet=1)` — fakes depth-of-field by
averaging many slightly jittered renders; the object at the origin stays in focus.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `aperture` | float | `2.0` | aperture angle in degrees |
| `samples` | int | `10` | number of images averaged |
| `ray` | 0/1 | `0` | ray-trace each sample instead of `draw` |
| `filename` | str | `''` | output image path; empty = temporary |
| `quiet` | int | `1` | suppress console output |

In this open-source build `focal_blur` raises `IncentiveOnlyException` (`experimenting.py:244`); the
port registers it as a no-op stub. `focal_blur 3.0, 50` is the documented usage.

## mpng

`mpng(prefix, first=0, last=0, preserve=0, modal=0, mode=-1, quiet=1, width=0, height=0)` — writes
the movie as a series of numbered `<prefix>####.png` files.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prefix` | str | — | filename prefix; frames are numbered and suffixed `.png` |
| `first` | int | `0` | first frame (inclusive); `0` = first |
| `last` | int | `0` | last frame (inclusive); `0` = last |
| `preserve` | 0/1 | `0` | only write files that do not already exist |
| `modal` | int | `0` | render frames with a modal draw loop |
| `mode` | int | `-1` | `2`=ray, `1`=draw, `0`=normal; `-1` checks `ray_trace_frames`/`draw_frames` |
| `quiet` | int | `1` | suppress console output |
| `width` | int | `0` | width in px; `0` = current viewport |
| `height` | int | `0` | height in px; `0` = current viewport |

### Behaviour

With `mode=-1` (default) the per-frame renderer is chosen by settings: `ray_trace_frames` on ⇒ each
frame is ray-traced (slow — potentially hours), otherwise a fast `draw`. `first`/`last` are converted
to 0-based internally and let you render a sub-range for distributed rendering. Avoid `cache_frames`
on long movies to prevent memory blow-up. The port's movie pipeline enables `opaque_background`
before writing frames (`packages/engine-ts/src/cmd/movie3.ts`).

## get_povray

`get_povray()` — returns a `(header, geometry)` string tuple forming a complete POV-Ray input file
for the current scene, for offline rendering with the `povray` binary (also reachable via `ray
renderer=1` and `save scene.pov`). The port registers it as a no-op returning `['', '']`.

## get_collada

`get_collada(version=2)` — returns a COLLADA (`.dae`) XML string of the currently displayed geometry.
Reached from `save scene.dae`. `collada_geometry_mode` toggles per-geometry vs. shared encoding. No
port path (C++/`_cmd.get_collada`).

## get_gltf

`get_gltf(filename, quiet=1)` — writes a glTF file. Implemented as a wrapper: it sets
`collada_geometry_mode=1`, produces COLLADA via `get_collada`, writes it to `filename`, then invokes
an external `collada2gltf` (or `COLLADA2GLTF-bin`) binary in place; raises if that binary is not on
`PATH`. Reached from `save scene.gltf`.

## get_idtf

`get_idtf(quiet=1)` — returns an IDTF (Intermediate Data Text Format, for U3D/3D-PDF) export of the
scene. Explicitly "under development" upstream. When `quiet=0` it also prints the `3Daac`/`3Droo`/
`3Dcoo` view parameters needed for embedding in a PDF. Reached from `save scene.idtf`.

## get_mtl_obj

`get_mtl_obj()` — returns a `(mtl, obj)` tuple of Wavefront material + geometry files for import into
Maya. Marked "an incomplete and unsupported feature": the `.MTL` half is not implemented and
`save`'s `mtl`/`obj` dispatcher raises `.MTL export not implemented` (`exporting.py:984`). The port
stubs it to `''`.

## get_vrml

`get_vrml(version=2)` — returns a VRML2 (`.wrl`) string of the current display for import into other
3D tools. Reached from `save scene.wrl`. No port path (C++/`_cmd.get_vrml`).

## get_stlstr

`get_stlstr(binary=1, quiet=0)` — STL geometry export (surfaces/CGO triangle soup), reached from
`save scene.stl`. In this open-source build it raises `IncentiveOnlyException("STL export not
supported by this PyMOL build")` (`lazyio.py:224`); the matching `read_stlstr` importer is likewise
incentive-only. Geometry exports generally flow through `save`/`get_str`/`get_bytes`, whose
extension→function map in `exporting.py:988` routes `dae/gltf/wrl/pov/idtf/mtl/obj/stl` to these
`get_*` functions.

## write_html_ref

`write_html_ref(file)` — writes the full PyMOL command reference (every non-underscore keyword and
its docstring) to a self-contained HTML file. A documentation/authoring utility rather than a scene
exporter, defined inline in `cmd.py` and not registered in the TypeScript port.

---

## Key settings

### antialias

`antialias` (integer 0–4, default `1`) — general antialiasing control for `ray`/`draw`. `0` = off,
`1` = adaptive antialiasing, higher values supersample more (with `ray_oversample_cutoff` gating).
The `ray`/`draw` `antialias=-1` argument means "use this setting". The port resolves `-1`→2× and
`≥2`→3× per-axis supersampling (`render.ts:105`).

### ray_shadow

`ray_shadow` (integer, default `1`; legacy alias `ray_shadows`) — whether the ray tracer casts
shadows. `cmd.util.ray_shadows(...)` presets (none/light/medium/heavy/black/matte/soft/occlusion)
tune this plus related lighting. Honoured by the port ray tracer (shadows on for `ray`, off for
`draw`).

### ray_trace_mode

`ray_trace_mode` (integer, default `0`) — cel-shading / outline style of the built-in ray tracer:
`0`=normal, `1`=colour with outlines, `2`=black & white outlines (use a white background),
`3`=quantised colour with outlines. Tuned by `ray_trace_gain`, `ray_trace_color`,
`ray_trace_disco_factor`, `ray_trace_depth_factor`, `ray_trace_slope_factor`. **No GL/port path** —
this is ray-only (`docs/feature-parity.md:559`).

### ray_trace_color

`ray_trace_color` (color, default `-6`) — outline/gain colour used by `ray_trace_mode` 1–3. Paired
with `ray_trace_gain` (float, default `0.12`), the gain applied to those outline modes.

### ray_trace_gain

`ray_trace_gain` (float, default `0.12`) — gain parameter for the `ray_trace_mode` 1–3 outline
darkening.

### ray_opaque_background

`ray_opaque_background` (integer, default `-1`) — whether the ray-traced background is opaque. `-1`
defers to `opaque_background`. Setting it `0` yields a transparent-background PNG from `ray`.

### opaque_background

`opaque_background` (boolean, default `on`) — whether the background is opaque for both GL and (when
`ray_opaque_background=-1`) ray output. `unset opaque_background` before `draw`/`ray` produces a
transparent PNG.

### ray_interior_color

`ray_interior_color` (color, default `-1`) — colour of clipped/interior surfaces in the ray tracer;
`-1` = same as exterior, a positive colour index (e.g. `74` grey50) paints "opaque interiors".

### ambient_occlusion_mode

`ambient_occlusion_mode` (integer, default `0`) — ambient-occlusion method: `0`=disabled,
`1`=atom-based, `2`=triangle-based (surfaces). Paired with `ambient_occlusion_scale` (float, default
`25.0`) and `ambient_occlusion_smooth` (int, default `10`). AO is baked into surface geometry so it
shows in both GL and ray output.

### ray_default_renderer

`ray_default_renderer` (integer, default `0`) — which renderer `ray` uses when `renderer=-1`:
`0`=built-in, `1`=PovRay (if available), `2`=geometry counter (no output).

### ray_trace_frames

`ray_trace_frames` (boolean, default `off`) — when on, `mpng` (and movie export) ray-traces every
frame instead of `draw`-ing it; slow but higher quality. Companion `draw_frames` (boolean, default
`on`) forces the `draw` path.

### image_dots_per_inch

`image_dots_per_inch` (float, default `0.0`) — DPI written into image files when non-zero; the `png`
`dpi=-1` argument falls back to this setting.

---

## Related

- [representations](representations.md) — the reps whose CPU geometry the ray tracer and exporters consume.
- `save` / `get_str` / `get_bytes` — the extension-dispatch entry points that route to every `get_*` exporter.
- `scene`, `mplay`, `mpng` — movie playback that feeds ray-traced frame export.

## Source

- `packages/engine/modules/pymol/viewing.py:1601` (`draw`), `:1662` (`ray`).
- `packages/engine/modules/pymol/exporting.py:499` (`png`), `:35` (`copy_image`), `:784`/`:988` (`save` + savefunctions dispatch).
- `packages/engine/modules/pymol/querying.py:547` (`get_povray`), `:563` (`get_idtf`), `:585` (`get_mtl_obj`), `:632` (`get_vrml`), `:648` (`get_collada`), `:664` (`get_gltf`).
- `packages/engine/modules/pymol/moving.py:366` (`mpng`), `experimenting.py:215` (`focal_blur`), `lazyio.py:224` (`get_stlstr`), `cmd.py:211` (`write_html_ref`).
- Ray tracer & settings: `packages/engine/layer1/Ray.cpp`, `packages/engine/data/setting_help.csv`.
- Parity port: `packages/engine-ts/src/render/{raytrace,png,camera,scene,primitives}.ts`, `packages/engine-ts/src/cmd/render.ts`, `movie3.ts`, `extras.ts`; `docs/feature-parity.md:559`, `docs/geometry-extraction.md`.
