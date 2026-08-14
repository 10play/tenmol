---
name: get_unused_name
kind: command
category: objects-groups
subcategory: name allocation
summary: Return an object/selection name not currently in use, derived from a prefix.
parity: unknown
---

## Purpose
`get_unused_name` returns a name guaranteed not to collide with any existing
object or selection, by appending a number to a prefix. Use it in scripts and
wizards that must create a temporary object without clobbering the user's names.

## Syntax
`get_unused_name(prefix='tmp', alwaysnumber=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prefix` | str | `'tmp'` | Base string for the generated name |
| `alwaysnumber` | int | `1` | If `1`, always append a number even when the bare prefix is free |

## Behaviour
Scans the current namespace and returns `prefix` followed by the lowest integer
that yields a free name (e.g. `tmp01`). With `alwaysnumber=0`, the bare `prefix`
is returned unchanged if it is already unused; with the default `1` a numeric
suffix is always added.

## Examples
```python
name = cmd.get_unused_name("sele")   # e.g. 'sele01'
cmd.create(cmd.get_unused_name("frag"), "chain A")
```

## Related
- [get_names](get_names.md), [get_object_list](get_object_list.md)

## Source
`packages/engine/modules/pymol/querying.py:74`. Parity: unknown — no direct
`get_unused_name` export found in `packages/engine-ts/src`.
