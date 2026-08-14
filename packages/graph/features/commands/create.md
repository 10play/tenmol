---
name: create
kind: command
category: objects-groups
subcategory: object creation
summary: Creates a new molecule object from a selection, or copies states into an existing object.
parity: unknown
---

## Purpose
`create` builds a new molecule object from an atom selection, and can also copy states between objects or append states to an existing one. It is the primary way to carve out a sub-object (e.g. a single chain, a ligand, one NMR model) as an independent, editable entity.

## Syntax
`create(name, selection, source_state=0, target_state=0, discrete=0, zoom=-1, quiet=1, singletons=0, extract=None, copy_properties=False)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of object to create or modify (auto-named if empty) |
| `selection` | str | — | Atoms to include in the new object |
| `source_state` | int | `0` | Source state; `0` copies all states |
| `target_state` | int | `0` | Target state; `-1` appends after the last state; `0` copies all |
| `discrete` | int | `0` | Create a discrete object (per-state atom sets) |
| `zoom` | int | `-1` | Zoom on the result (`-1` = `auto_zoom`) |
| `quiet` | int | `1` | Suppress status output when `1` |
| `singletons` | int | `0` | Include singleton atoms handling |
| `extract` | any | `None` | If truthy, remove copied atoms from the source (see `extract`) |
| `copy_properties` | bool | `False` | Copy object/atom properties into the new object |

## Behaviour
If `source_state` and `target_state` are both `0` (default), all states are copied; otherwise only the indicated states. `target_state=-1` computes the append position via `count_states('?'+name)+1`. An empty `name` gets an auto-generated `obj*` name. When `extract` is truthy it selects the extract set, and after a successful create removes those atoms from the source object (this is exactly what the `extract` command does via `create(..., extract=1)`). Internally states are passed as `state-1`. `discrete=1` yields an object whose states may hold different atoms.

## Examples
```python
create chainA, 1ubq and chain A
create ligand, resn STI
create ensemble, model1, target_state=-1   # append as a new state
```

## Related
- [copy](../commands/copy.md)
- [extract](../commands/extract.md)
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/creating.py:974` (`def create`). No confirmed dedicated TypeScript command registration found in `packages/engine-ts/src`; parity unverified.
