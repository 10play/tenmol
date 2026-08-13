---
name: set_colorection
kind: command
category: coloring
subcategory: color sessions
summary: Restores a saved set of color assignments (a "colorection") from a dict under a given key.
parity: implemented
---

## Purpose
`set_colorection` is the inverse of `get_colorection`: it applies a previously captured collection of per-object/per-atom color assignments back onto the scene. Colorections are the mechanism scenes and sessions use to snapshot and restore coloring state.

## Syntax
`set_colorection(dict, key)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dict` | dict | — | the colorection data (as produced by `get_colorection`) |
| `key` | str | — | the key under which the color set is stored/named |

## Behaviour
The `dict`/`key` pair identifies a stored color set; applying it reassigns colors across the affected objects and atoms. It is a low-level API used internally by scene/session color storage rather than a routine interactive command. Pair it with `get_colorection` (capture) and `del_colorection` (discard).

## Examples
```python
cec = cmd.get_colorection(some_dict, "scene1")
# ... later ...
cmd.set_colorection(cec, "scene1")
```

## Related
- [set_color](set_color.md) — define a single color
- [del_colorection](del_colorection.md) — remove a stored color set

## Source
Upstream: `packages/engine/modules/pymol/viewing.py:911`. Parity: implemented at `packages/engine-ts/src/cmd/misc2.ts:85`.
