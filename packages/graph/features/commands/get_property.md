---
name: get_property
kind: command
category: properties
subcategory: object properties
summary: Read a single named object-level property from an object for a given state.
parity: implemented
---

## Purpose
`get_property` retrieves one object-level custom property (as set by
`set_property`) from a named object. Use it to read metadata attached to whole
objects (as opposed to per-atom `p.` properties).

## Syntax
`get_property(propname, name, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `propname` | string | — | Name of the property to read |
| `name` | string | — | Name of a single object |
| `state` | int | `0` | Object state; `0` = all states, `-1` = current state (passed as `state-1`) |
| `quiet` | int | `1` | If `0`, prints the value (or "not found") to the console |

## Behaviour
Returns the property value, or `None` if the property name is empty or an error
occurs. The value is coerced to its stored type; a `PROPERTY_COLOR`-typed value is
translated back from a color index to a color name when printed. `state` is
passed to the engine as `state-1`, so the default `0` means all states.

## Examples
```python
cmd.get_property("Title", "myprot")
cmd.get_property("pH", "myprot", quiet=0)
```

## Related
- [get_property_list](get_property_list.md), [set_property](set_property.md)

## Source
`packages/engine/modules/pymol/properties.py:54`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/props.ts:84`.
