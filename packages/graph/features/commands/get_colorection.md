---
name: get_colorection
kind: command
category: coloring
subcategory: color selection state
summary: Returns the stored "colorection" (color-selection) association for a key.
parity: implemented
---

## Purpose
`get_colorection` retrieves a stored *colorection* — PyMOL's internal association between a key and a set of colored selections — used mainly by the coloring machinery and session save/restore. It is a low-level accessor rather than an everyday command.

## Syntax
`get_colorection(key)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `key` | str | — | Colorection key to look up |

## Behaviour
Acquires the lock and dispatches to `_cmd.get_colorection(key)`, returning the stored structure. It pairs with `set_colorection(dict, key)` and `del_colorection(dict, key)` in the same module — together they snapshot and restore per-color atom selections (e.g. for the color menus / session persistence).

## Examples
```python
data = cmd.get_colorection("mykey")
cmd.set_colorection(data, "mykey")
```

## Related
- [get_color_indices](../commands/get_color_indices.md)

## Source
Upstream `packages/engine/modules/pymol/viewing.py:907`. Parity: implemented — registered as `ctx.command('get_colorection')` in `packages/engine-ts/src/cmd/misc2.ts:74`.
