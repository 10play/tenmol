---
name: get_property_list
kind: command
category: properties
subcategory: object properties
summary: Return all object-level properties of an object (for a given state) as a list.
parity: implemented
---

## Purpose
`get_property_list` retrieves every object-level custom property stored on an
object for a given state, as a list of entries. Use it to enumerate metadata
attached to an object rather than reading one property at a time.

## Syntax
`get_property_list(object, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | — | Name of a single object |
| `state` | int | `0` | Object state; `0` = all states, `-1` = current state (passed as `state-1`) |
| `quiet` | int | `1` | If `0`, prints the property list to the console |

## Behaviour
Implemented as a call to the same C-layer `get_property` entry point with a
`None` property name, which signals "return all". `state` is passed as `state-1`,
so the default `0` covers all states. Returns the engine's property list (or an
error sentinel on failure).

## Examples
```python
cmd.get_property_list("myprot")
cmd.get_property_list("myprot", state=-1, quiet=0)
```

## Related
- [get_property](get_property.md), [set_property](set_property.md)

## Source
`packages/engine/modules/pymol/properties.py:99`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/props.ts:97`.
