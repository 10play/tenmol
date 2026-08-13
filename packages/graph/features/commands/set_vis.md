---
name: set_vis
kind: command
category: representations-display
subcategory: visibility
summary: Restores object/representation visibility state from a visibility dictionary (counterpart of get_vis).
parity: implemented
---

## Purpose
`set_vis` reapplies a captured visibility snapshot — which objects are enabled and which representations are shown — from the dictionary produced by `get_vis`. It is used internally by scenes and session restore to reinstate the exact show/hide/enable state.

## Syntax
`set_vis(dict)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dict` | dict | — | Visibility dictionary as returned by `get_vis` |

## Behaviour
A minimal lock-guarded pass-through to `_cmd.set_vis`. The dictionary keys objects to their per-representation visibility flags; applying it toggles enable/disable and representation visibility to match. Intended for round-tripping with `get_vis` rather than hand construction.

## Examples
```python
v = cmd.get_vis()
cmd.hide('everything')
cmd.set_vis(v)   # restore prior visibility
```

## Related
- [get_vis](./get_vis.md)
- [show](./show.md)
- [scene](./scene.md)

## Source
`packages/engine/modules/pymol/viewing.py:903`; signature in `docs/api-reference/commands.mdx:3753`. Parity: implemented in `packages/engine-ts/src/cmd/display.ts`.
