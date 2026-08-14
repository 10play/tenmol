---
name: cache
kind: command
category: rendering-export
subcategory: surface cache
summary: Manages storage of precomputed results such as molecular surfaces.
parity: partial
---

## Purpose
`cache` controls PyMOL's store of precomputed geometry (most importantly
molecular surfaces) so that expensive results can be reused across scenes.
Reach for it to enable/disable caching or to pre-warm the cache before a movie
or presentation.

## Syntax
`cache(action='optimize', scenes='', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | string | `'optimize'` | `enable`, `disable`, `read_only`, `clear`, or `optimize`. |
| `scenes` | string | `''` | Space-separated list of scene names. |
| `state` | integer | `-1` | State index. |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
`action` is resolved through a shortcut table and maps to `cache_mode`:
`enable` sets `cache_mode=2`, `disable` sets `0`, `read_only` sets `1`, and
`clear` purges stored results. `optimize` iterates the given scenes (or all
defined scenes when `scenes` is empty), temporarily raises `cache_max`, visits
each scene with `scene`, `rebuild`, and `refresh` to compute and store any
missing surfaces, then restores the previous cache mode and limits and reports
approximate memory usage. With no scenes defined it simply optimizes the current
display.

## Examples
```
cache enable
cache optimize
cache optimize, F1 F2 F5
```

## Related
- [scene](../commands/scene.md)
- [rebuild](../commands/rebuild.md)

## Source
`packages/engine/modules/pymol/exporting.py:48`. In the TS port `cache` is a
registered no-op accepted for compatibility (listed among "misc app / render
controls with no state to observe" in `packages/engine-ts/src/cmd/extras.ts`).
