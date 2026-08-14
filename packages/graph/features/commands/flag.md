---
name: flag
kind: command
category: selecting
subcategory: atom flags
summary: Sets or clears a named/numbered atom flag over a selection, controlling modeling roles like fixed, free, focus, and ignore.
parity: unknown
---

## Purpose
`flag` sets the indicated flag on atoms in a selection (and, by default, clears it on all others). Flags carry modeling metadata - which atoms are fixed, free to move, restrained, of interest, or excluded from surfacing - consumed by sculpting, minimization, and Chempy models.

## Syntax
`flag(flag, selection, action='reset', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `flag` | str or int | | flag name or number |
| `selection` | str | | atom selection |
| `action` | str | `'reset'` | `reset` = set on selection and clear on all others; `set` = set on selection only; `clear` = clear on selection only |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The default `action=reset` both sets the flag inside the selection and clears it outside. `set` and `clear` leave non-selected atoms untouched. If the `auto_indicate_flags` setting is true, PyMOL creates an `indicate` selection of all atoms carrying the flag after the command. Special reserved flags include: focus 0, free 1, restrain 2, fix 3, exclude 4, study 5; protein/nucleic classification 6-7; user 8-15; external GUI 16-21; temporary 22-23; internal 24-31 (ignore 25, no_smooth 26). Flag 24 (exfoliate) is deprecated in favor of `hide surface`.

## Examples
```python
flag free, (resi 45 x; 6)
flag fix, not (polymer), set
flag ignore, solvent, set
```

## Related
- [sculpt_activate](sculpt_activate.md) - honors free/fix/restrain flags
- [indicate](indicate.md) - selection created by auto_indicate_flags

## Source
`packages/engine/modules/pymol/editing.py` (`def flag`). Parity: not registered as an engine-ts command.
