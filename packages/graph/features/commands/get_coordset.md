---
name: get_coordset
kind: command
category: querying
subcategory: coordinate query
summary: Returns an object's coordinate set for a state as a NumPy array (API-only).
parity: implemented
---

## Purpose
`get_coordset` returns the full coordinate set of a named object for a given state as a NumPy array. Reach for it when you want an object's entire coordinate block by name (rather than by selection).

## Syntax
`get_coordset(name, state=1, copy=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name |
| `state` | int | `1` | State index |
| `copy` | 0/1 | `1` | If `0`, return a live wrapper over internal memory (dangerous) |
| `quiet` | 0/1 | `1` | Verbosity |

## Behaviour
API-only. Dispatches to `_cmd.get_coordset(name, state-1, copy)`, returning an `N×3` NumPy array. **`copy=0` gotcha:** it returns a NumPy array that wraps the object's internal coordinate memory directly — if that memory is freed or reallocated (e.g. by editing), the wrapper becomes invalid and may read garbage or crash. Use `copy=0` only if you fully understand the object's lifetime; otherwise keep the default `copy=1` which memcpys.

## Examples
```python
cs = cmd.get_coordset("myobj", state=1)
cs = cmd.get_coordset("myobj", state=2, copy=0)   # advanced: live view
```

## Related
- [get_coords](../commands/get_coords.md)
- [load_coordset](../commands/load_coordset.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:921`; native `CoordSetAsNumPyArray` at `packages/engine/layer2/CoordSet.cpp:326`. Parity: implemented — registered as `ctx.command('get_coordset')` in `packages/engine-ts/src/cmd/xform.ts:158`.
