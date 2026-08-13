---
name: get_object_color_index
kind: command
category: coloring
subcategory: color query
summary: Returns the integer color index assigned to a named object.
parity: implemented
---

## Purpose
`get_object_color_index` returns the numeric color index currently set on a whole object (the object-level color, as opposed to per-atom colors). Use it to read an object's color for cloning, comparison, or legend generation.

## Syntax
`get_object_color_index(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | (required) | Object name |

## Behaviour
Locks the command layer and returns the integer color index from `_cmd.get_object_color_index`. This index can be resolved to an RGB tuple with `get_color_tuple`. No engine docstring is present.

## Examples
```python
idx = cmd.get_object_color_index("1abc")
rgb = cmd.get_color_tuple(idx)
```

## Related
- [get_color_tuple](../commands/get_color_tuple.md)
- [color](../commands/color.md)
- [get_color_index](../commands/get_color_index.md)

## Source
`packages/engine/modules/pymol/querying.py:819`. Parity: used/implemented in `packages/engine-ts/src/cmd/preset.ts`.
