---
name: scene_order
kind: command
category: movies-scenes-states
subcategory: scenes
summary: Reorders stored scenes, optionally sorting them and placing them at the top, current, or bottom.
parity: planned
---

## Purpose
`scene_order` rearranges the sequence in which scenes are stepped through. Use it to curate presentation flow after storing scenes out of order, or to alphabetically sort them.

## Syntax
`scene_order(names, sort=0, location='current', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `names` | string or list | — | space-separated list of scene names (or a Python list) |
| `sort` | yes/no | `0` | sort the given names |
| `location` | string | `'current'` | insertion point: `top`, `current`, or `bottom` |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
`location` is resolved through a shortcut allowing `top`/`current`/`bottom`; `sort` accepts boolean-like strings. A string `names` is split on whitespace, so scene names containing spaces must be passed as a Python list. `names='*'` with `sort=yes` sorts all scenes. The reordering is applied relative to the chosen `location`.

## Examples
```python
scene_order *, yes
scene_order F6 F4 F3
scene_order 003 006 004, location=top
```

## Related
- [scene](../commands/scene.md)

## Source
`packages/engine/modules/pymol/viewing.py:961`; signature in `docs/api-reference/commands.mdx:3397`. Parity: registered as a no-op stub in `packages/engine-ts/src/cmd/extras.ts`; planned.
