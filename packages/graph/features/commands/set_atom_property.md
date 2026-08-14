---
name: set_atom_property
kind: command
category: properties
subcategory: atom properties
summary: Sets a custom atom-level property (p.<name>) on the atoms of a selection.
parity: implemented
---

## Purpose
`set_atom_property` writes a user-defined property onto individual atoms, stored under the `p.` namespace and readable via `iterate`/`alter` (`p.<name>`). Use it to attach arbitrary per-atom metadata — scores, flags, labels — that travels with the atoms and survives session save.

## Syntax
`set_atom_property(name, value, selection='all', state=0, proptype=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name of the property |
| `value` | str/int/float/bool | — | value to store |
| `selection` | str | `'all'` | atoms to write to |
| `state` | int | `0` | object state; `0` = all states, `-1` = current state |
| `proptype` | int | `-1` | property type: `-1`=auto, `1`=bool, `2`=int, `3`=float, `5`=color, `6`=str |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
With `proptype=-1` (auto), the value is coerced by inspection: digit-only strings become int, numeric strings become float, and `true/false/yes/no` become bool; anything else stays a string. Forcing `proptype` overrides this (e.g. `proptype=6` keeps `false` as the literal string). Setting a property to `None` via `alter` clears it. Values are reachable in expressions as `p.<name>` (e.g. `iterate all, print(p.myprop)`).

## Examples
```python
set_atom_property myfloatprop, 1.23, elem C
set_atom_property myfloatprop, 1234, elem N, proptype=3
set_atom_property mystrprop, false, elem O, proptype=6
```

## Related
- [set_property](set_property.md) — object-level properties
- [iterate](iterate.md), [alter](alter.md) — read/modify properties

## Source
Upstream: `packages/engine/modules/pymol/properties.py:171`. Parity: implemented at `packages/engine-ts/src/cmd/props.ts:113`.
