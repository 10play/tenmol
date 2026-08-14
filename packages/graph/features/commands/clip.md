---
name: clip
kind: command
category: viewing-camera
subcategory: clipping planes
summary: Moves the near/far clipping planes or sets the slab thickness.
parity: implemented
---

## Purpose
`clip` adjusts the positions of the near and far clipping planes, controlling
which depth range of the scene is visible. Reach for it to cut away foreground
or background, thin the visible slab, or frame a region for a figure.

## Syntax
`clip(mode, distance, selection=None, state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | str | — | `near`, `far`, `move`, `slab`, or `atoms`. |
| `distance` | float | — | Distance in angstroms (interpretation depends on `mode`). |
| `selection` | str/None | `None` | Atoms to clip about (for `mode=atoms` / `slab`). |
| `state` | int | `0` | State index. |

## Behaviour
`mode` is resolved via a shortcut table (which also recognizes internal
`near_set`/`far_set`). `near`/`far` move the respective plane by `distance`;
`move` shifts the whole slab; `slab` sets the slab thickness (optionally centered
about a selection); `atoms` clips around the selection with `distance` as a
buffer about the atoms' current camera positions. When a `selection` is given it
is processed with `selector.process`; `state` is passed as `state - 1`
internally.

## Examples
```
clip near, -5
clip slab, 20
clip slab, 10, resi 11
clip atoms, 5, pept
```

## Related
- [zoom](../commands/zoom.md)
- [orient](../commands/orient.md)
- [reset](../commands/reset.md)

## Source
`packages/engine/modules/pymol/viewing.py:181`. Ported in
`packages/engine-ts/src/cmd/transforms.ts` (`clip`).
