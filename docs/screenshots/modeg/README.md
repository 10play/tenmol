# Mode G rep coverage — what each image is

Captions for the PNGs in this directory. Every one is a real headless-Chromium
screenshot of the real viewport driven by the real bridge and a real PyMOL, at
800x600, dpr 1, with ONE frozen camera per structure.

Naming:

| suffix   | what it is                                                                  |
| -------- | --------------------------------------------------------------------------- |
| `-P`     | Mode P only — PyMOL's own renderer, streamed pixels, WebGL canvas hidden.   |
| `-G-old` | Mode G only — `modeG/frames.ts` as it stands, Mode-P canvas hidden.         |
| `-G-new` | Mode G only — `webgl/builder.ts` (this work package), Mode-P canvas hidden. |

Structures: `1UBQ` for everything except `ellipsoids-*` (`1EJG`, which has
ANISOU records) and `cgo_cone-*` (a three-primitive `load_cgo`: a cone, a
truncated cone and a `CYLINDER`).

## Measured, same camera, same frame

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
| ellipsoids | IoU .000        | IoU .215 dE 52  | new impostor; WRONG SIZE — see below                        |
| ribbon     | IoU .000        | IoU .000        | nothing on the wire (`unmapped: {lines: 75}`)               |
| lines      | IoU .000        | IoU .000        | nothing on the wire (`unmapped: {lines: 718}`)              |
| nonbonded  | IoU .000        | IoU .000        | nothing on the wire (`unmapped: {crosses: 58}`)             |

`ribbon`, `lines` and `nonbonded` produce an all-black `-G-*` image on purpose:
that is what the rep looks like today. The difference between the two columns is
that `-G-new` REPORTS it, so the render policy falls the rep back to Mode P
instead of showing a black screen labelled "Mode G".

## `ellipsoids-G-new-axes-times-r.png`

The same frame with each instance's three axis vectors multiplied by the
`xyzr[3]` scalar the bridge drops in `_ellipsoids` (`_drop_fourth`). IoU goes
0.215 -> 0.910 and dE 52.2 -> 6.9. The axes on the wire are normalised so the
longest is 1.0 (measured on 1EJG: `|n1|,|n2|,|n3| = 0.554, 0.909, 1.000` with
`r = 0.434`), and `CGOSimpleEllipsoid` (`packages/engine/layer1/CGO.cpp:6320-6420`) puts the
surface at `v + r * (u0*n0 + u1*n1 + u2*n2)`, so the semi-axes are `r * |n_i|`,
not `|n_i|`.

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
