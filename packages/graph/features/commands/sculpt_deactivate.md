---
name: sculpt_deactivate
kind: command
category: sculpting-minimization
subcategory: sculpting
summary: Turns off sculpting for an object and discards its stored geometry restraints.
parity: implemented
---

## Purpose
`sculpt_deactivate` is the counterpart to `sculpt_activate`: it disables sculpting on the named object and clears the reference-geometry restraints that were recorded when sculpting was switched on. Reach for it when you are done interactively deforming a structure and want to stop the real-time energy minimization.

## Syntax
`sculpt_deactivate(object)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | name of a single object, or `"all"` to deactivate every object |

## Behaviour
The stored restraint set (bond lengths, angles, dihedrals, VDW terms captured at `sculpt_activate` time) is freed, so a subsequent `sculpt_iterate` on the same object does nothing until you re-activate it. Passing `"all"` deactivates sculpting across every object. The command returns a status code and is a no-op if the object was never activated.

## Examples
```python
sculpt_activate mol
# ... interactive editing / sculpt_iterate ...
sculpt_deactivate mol
```

## Related
- [sculpt_activate](sculpt_activate.md) — enable sculpting and record reference geometry
- [sculpt_iterate](sculpt_iterate.md) — run the minimization steps

## Source
Upstream: `packages/engine/modules/pymol/editing.py:120`. Parity: implemented in the TS engine at `packages/engine-ts/src/cmd/sculpt.ts:364` (deletes the object's restraint cache entry).
