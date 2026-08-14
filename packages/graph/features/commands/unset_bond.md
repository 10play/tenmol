---
name: unset_bond
kind: command
category: settings
subcategory: per-bond setting reset
summary: Removes a per-bond setting for the bonds between two atom selections.
parity: implemented
---

## Purpose
`unset_bond` clears a bond-level setting override (e.g. `stick_radius`, `stick_color`, `valence`) for the bonds spanning two selections, reverting them to the object/global value. It is the per-bond counterpart of `unset` and the inverse of `set_bond`.

## Syntax
`unset_bond(name, selection1, selection2=None, state=0, updates=1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | bond setting name (or index) to clear |
| `selection1` | selection | — | first endpoint set |
| `selection2` | selection | `None` | second endpoint set; defaults to `selection1` |
| `state` | int | `0` | state for per-state values (0 = current/all) |
| `updates` | int | `1` | trigger scene updates |
| `log` | int | `0` | echo the equivalent call to the log |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Both selections are processed; if `selection2` is omitted it reuses `selection1` (so a single selection targets bonds internal to it). The name resolves via `_get_index`, then `_cmd.unset_bond(_COb, index, sel1, sel2, state-1, quiet, updates)` removes the override from every bond joining the two selections. Only bonds already carrying that per-bond setting are affected.

## Examples
```python
# revert stick radius on the bonds within a residue
unset_bond stick_radius, resi 50

# clear a per-bond color between two selections
unset_bond stick_color, chain A, chain B
```

## Related
- [set_bond](../commands/set_bond.md)
- [unset](../commands/unset.md)

## Source
`packages/engine/modules/pymol/setting.py:324`. Parity: implemented in `packages/engine-ts/src/cmd/settings2.ts`.
