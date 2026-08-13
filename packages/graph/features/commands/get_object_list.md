---
name: get_object_list
kind: command
category: objects-groups
subcategory: name listing
summary: Returns the object names covered by a selection (unsupported command).
parity: unknown
---

## Purpose
`get_object_list` is an unsupported command that returns the list of object names covered by a selection — i.e. which objects contain atoms in the given selection. Despite the "unsupported" label it is used internally by the builder and export dialogs.

## Syntax
`get_object_list(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Selection whose covering objects are listed |
| `quiet` | 0/1 | `1` | If `0`, prints the resulting list |

## Behaviour
The selection is processed via `selector.process`, then `_cmd.get_object_list` returns the object names. With `quiet=0` and a list result it prints `get_object_list: <list>`. Differs from `get_names` in that it is scoped by selection membership rather than by a type category.

## Examples
```python
objs = cmd.get_object_list("chain A")
```

## Related
- [get_names](./get_names.md)
- [get_names_of_type](./get_names_of_type.md)

## Source
`packages/engine/modules/pymol/querying.py:131`. Parity: no TypeScript port found; upstream marks it unsupported; parityStatus unknown.
