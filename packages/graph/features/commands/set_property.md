---
name: set_property
kind: command
category: properties
subcategory: object properties
summary: Sets a named object-level property (metadata) on one or more objects.
parity: implemented
---

## Purpose
`set_property` attaches a typed key/value pair to whole objects, storing arbitrary metadata (numbers, strings, booleans, colors) that travels with the object and its session. Use it to tag conformers, scores or annotations at the object level; use `set_atom_property` for per-atom metadata.

## Syntax
`set_property(name, value, object='*', state=0, proptype=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | Name of the property |
| `value` | str/int/float/bool | — | Value to be set |
| `object` | string | `'*'` | Space-separated list of objects, or `*` for all objects |
| `state` | int | `0` | Object state; 0 = all states, -1 = current state |
| `proptype` | int | `-1` | Property type: -1=auto, 1=bool, 2=int, 3=float, 5=color, 6=str |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
The Python wrapper decrements `state` by one before dispatching (1-based to 0-based). With `proptype=-1` (auto) the value is coerced by inspection: digit-only strings become int, numeric strings become float, and `true/false/yes/no` become bool. Passing an explicit `proptype` forces the storage type via the internal `_typecast` helper. `object='*'` applies the property to every object at once.

## Examples
```python
fragment ala
set_property myfloatprop, 1234, ala, proptype=3
get_property myfloatprop, ala
```

## Related
- [get_property](./get_property.md)
- [set_atom_property](./set_atom_property.md)

## Source
`packages/engine/modules/pymol/properties.py:123`; signature in `docs/api-reference/commands.mdx:3657`. Parity: implemented in `packages/engine-ts/src/cmd/props.ts`.
