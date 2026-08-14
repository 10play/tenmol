---
name: get_color_indices
kind: command
category: coloring
subcategory: color table
summary: Returns the list of (name, index) pairs for the color table.
parity: implemented
---

## Purpose
`get_color_indices` returns the color table as a list of `(name, index)` pairs. Reach for it to enumerate available named colors and their internal indices.

## Syntax
`get_color_indices(all=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `all` | 0/1 | `0` | If `1`, include all colors (including special/hidden ones); if `0`, the standard palette |

## Behaviour
Acquires the lock and calls `_cmd.get_color('', 2)` when `all` is truthy, otherwise `_cmd.get_color('', 1)` — the two enumeration modes of the color-table accessor. Returns a list of `(name, index)` tuples. Prefer this over calling `get_color_tuple` with `mode=1`/`2` (which warns and redirects here).

## Examples
```python
for name, idx in cmd.get_color_indices():
    print(name, idx)
all_colors = cmd.get_color_indices(all=1)
```

## Related
- [get_color_index](../commands/get_color_index.md)
- [get_color_tuple](../commands/get_color_tuple.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:843`. Parity: implemented — registered as `ctx.command('get_color_indices')` in `packages/engine-ts/src/cmd/display.ts:165`.
