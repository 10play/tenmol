# Mode G rep coverage — what each image is

Captions for the PNGs in this directory. Every one is a real headless-Chromium
screenshot of the real viewport driven by the real bridge and a real PyMOL.

`packages/viewport/src/webgl/mesh.ts` and `packages/viewport/src/webgl/builder.ts`
both point a reader at this directory by name, which is why it is kept.

> **STATUS — this file was one commit stale and is corrected below (2026-08-02).**
> Commit `48f62e7c` "feat: draw lines and crosses in Mode G" added four PNGs here
> and did not touch this README. Three rows of the table below — `ribbon`,
> `lines`, `nonbonded` — say "nothing on the wire". **That is no longer true**; see
> §"After the line/cross fix". The `ellipsoids` "WRONG SIZE" row is also fixed:
> the axes-times-`r` correction is implemented, in
> `packages/bridge/tenmol_bridge/render/modeg.py:_scale_axes_by_radius`.

Naming:

| suffix   | what it is                                                                  |
| -------- | --------------------------------------------------------------------------- |
| `-P`     | Mode P only — PyMOL's own renderer, streamed pixels, WebGL canvas hidden.   |
| `-G-old` | Mode G only — `modeG/frames.ts` as it stands, Mode-P canvas hidden.         |
| `-G-new` | Mode G only — `webgl/builder.ts` (this work package), Mode-P canvas hidden. |
| `-G-linefix` | **A later, different capture** — see §"After the line/cross fix". |

The `-P` / `-G-old` / `-G-new` set is 800x600, dpr 1, with ONE frozen camera per
structure and the app chrome cropped away. The four `-G-linefix` /
`measurements-G` images are **not** to that convention: they are 1056x644 @1x
full-window shots that include the HUD counter, which is the point of them.

Structures: `1UBQ` for everything except `ellipsoids-*` (`1EJG`, which has
ANISOU records) and `cgo_cone-*` (a three-primitive `load_cgo`: a cone, a
truncated cone and a `CYLINDER`). The `-G-linefix` set is `1TII` (5,684 atoms).

## Measured, same camera, same frame

The `-G-old` / `-G-new` columns are the state at the time of that work package.
Rows marked **SUPERSEDED** were fixed afterwards and the newer evidence is in
the section after this one.

`IoU` is over the non-background masks; `dE` is the mean per-channel colour
error over the overlap, 0-255.

| rep        | `-G-old`        | `-G-new`        | note                                                        |
| ---------- | --------------- | --------------- | ----------------------------------------------------------- |
| cartoon    | IoU .979 dE 7.1 | IoU .979 dE 7.1 | unchanged; was already right                                |
| sticks     | IoU .999 dE 3.5 | IoU .999 dE 3.5 | unchanged                                                   |
| spheres    | IoU 1.00 dE 1.9 | IoU 1.00 dE 1.9 | unchanged                                                   |
| nb_spheres | IoU .984 dE 2.4 | IoU .984 dE 2.4 | first visual verification                                   |
| cell       | IoU .919 dE 36  | IoU .919 dE 36  | geometry right, line colour wrong (no colour array on wire) |
| surface    | IoU .774 dE 39  | IoU .919 dE 8.6 | `buffers.vis` now filters the index                         |
| mesh       | IoU .484 dE 48  | IoU .953 dE 26  | `buffers.strip` now expands to GL_LINES, not points         |
| dots       | IoU .000        | IoU .837 dE 59  | radius-0 spheres now drawn as screen-space points           |
| cgo cone   | IoU .000        | IoU .995 dE 1.9 | new cone impostor                                           |
| ellipsoids | IoU .000        | IoU .215 dE 52  | **SUPERSEDED** — new impostor, WRONG SIZE. Fixed; see below  |
| ribbon     | IoU .000        | IoU .000        | **SUPERSEDED** — was `unmapped: {lines: 75}`; now drawn      |
| lines      | IoU .000        | IoU .000        | **SUPERSEDED** — was `unmapped: {lines: 718}`; now drawn     |
| nonbonded  | IoU .000        | IoU .000        | **SUPERSEDED** — was `unmapped: {crosses: 58}`; now drawn    |

At the time of that table, `ribbon`, `lines` and `nonbonded` produced an
all-black `-G-*` image on purpose: that is what the rep looked like then. The
difference between the two columns is that `-G-new` REPORTS it, so the render
policy falls the rep back to Mode P instead of showing a black screen labelled
"Mode G". **That reporting is what made the next fix possible, and it is still
the mechanism** — it is now what makes measurement objects fall back (below).

## After the line/cross fix — the four `1TII` full-window shots

The gap was never in the C++ accessor: it extracted all three reps. It was in
the bridge, which had no packer for the `lines` and `crosses` buckets, so the
frames arrived with `payloadBytes: 0` and an `unmapped` census. Commit
`48f62e7c` added `_lines` and `_crosses`
(`packages/bridge/tenmol_bridge/render/modeg.py`), two protocol instance kinds,
and the client-side cross expansion. Read the HUD line in each image — it is the
measurement.

| image | command | HUD (`Mode G:`) | what it shows |
| ----- | ------- | --------------- | ------------- |
| `lines-G-linefix.png` | `hide everything; show lines, u; orient` | 1 frame · 1 draw · **6681 instances** · 0 tris | the `lines` rep drawing in Mode G; per-vertex colour, so a bicoloured `CGO_SPLITLINE` keeps both ends |
| `ribbon-G-linefix.png` | `hide everything; show ribbon, u; orient` | 3 frames · 1 draw · **704 instances** · 0 tris | `ribbon` through the same line-instance path |
| `nonbonded-G-linefix.png` | `hide everything; show nonbonded, u; orient` | 5 frames · 1 draw · **645 instances** · 0 tris | 215 crosses expanded client-side into 3 axis-aligned arms each (215 x 3 = 645), so the wire stays at a third the size and the arm length follows `nonbonded_size` with no refetch |
| `measurements-G.png` | `show lines, u` then `distance dd` / `angle aa` / `dihedral hh` | **0 frames · 0 draws · 0 instances** | **the remaining gap, not a fix.** Dashes, angles and dihedrals still fall back to Mode P entirely — Mode P is doing 27 frames / png 269 kB here. It is not a packer gap: the accessor returns them and `web_get_versions` lists them; the client never pulls geometry for measurement objects. They stay visible, via Mode P. |

Known, and not a defect anyone can fix here: **`line_width` cannot be honoured.**
WebGL2 core clamps `gl.lineWidth` to 1.0.

## `ellipsoids-G-new-axes-times-r.png` — and it is now the shipped behaviour

The same frame with each instance's three axis vectors multiplied by the
`xyzr[3]` scalar the bridge used to drop in `_ellipsoids` (`_drop_fourth`). IoU goes
0.215 -> 0.910 and dE 52.2 -> 6.9. The axes on the wire are normalised so the
longest is 1.0 (measured on 1EJG: `|n1|,|n2|,|n3| = 0.554, 0.909, 1.000` with
`r = 0.434`), and `CGOSimpleEllipsoid` (`packages/engine/layer1/CGO.cpp:6320-6420`) puts the
surface at `v + r * (u0*n0 + u1*n1 + u2*n2)`, so the semi-axes are `r * |n_i|`,
not `|n_i|`.

**This is no longer a hypothetical.** The multiplication is done on the bridge,
in `_scale_axes_by_radius` (`packages/bridge/tenmol_bridge/render/modeg.py`),
whose docstring gives the same reason. So `ellipsoids-G-new.png` is the *old*
behaviour and `ellipsoids-G-new-axes-times-r.png` is the current one.

## `transparency-*`

`show surface; show sticks; set transparency, X`, 1UBQ.

| X   | IoU   | mean dE | note                                                   |
| --- | ----- | ------- | ------------------------------------------------------ |
| 0   | 0.998 | 8.3     | opaque baseline                                        |
| 0.5 | 0.998 | 11.6    | with the flat-alpha fix in `webgl/mesh.ts`             |
| 0.5 | 0.998 | 57.4    | BEFORE that fix — `defaultAlpha` ignored, drawn opaque |

Order-independent transparency is NOT ported. What `-G-new` does is
order-DEPENDENT alpha blending of a single depth-sorted-by-nothing mesh, which
is why interior facets of the surface show through in
`transparency-0.5-G-new.png` where Mode P shows a clean single layer. The
builder reports this as a problem, so the render policy falls a transparent
surface back to Mode P rather than showing the divergence silently.
