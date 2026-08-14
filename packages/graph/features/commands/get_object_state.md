---
name: get_object_state
kind: command
category: querying
subcategory: object state
summary: Return the effective (currently displayed) state index for a single object.
parity: implemented
---

## Purpose
`get_object_state` resolves the effective state of an object, accounting for
`static_singletons`, `all_states`, and the object's `state` setting. Use it when
a script needs the state index PyMOL is actually rendering for an object rather
than the global state.

## Syntax
`get_object_state(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name |

## Behaviour
A pure-Python resolver: it counts the object's states, then:
- If the object has fewer than 2 states and `static_singletons` is on, returns `1`.
- If the object's `all_states` setting is on, returns `0` (show all states).
- Otherwise returns the object's `state` setting, raising `CmdException` if that
  index exceeds the number of states available.

## Examples
```python
cmd.get_object_state("myprot")
```

## Related
- [get_selection_state](get_selection_state.md), [get_state](get_state.md), [count_states](count_states.md)

## Source
`packages/engine/modules/pymol/querying.py:1503`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/xform.ts:189`.
