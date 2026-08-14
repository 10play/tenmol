---
name: protect
kind: command
category: editing-building
subcategory: transform masking
summary: Marks atoms as protected so editing transformations skip them.
parity: implemented
---

## Purpose
`protect` flags a set of atoms so that interactive editing transformations
(moving, rotating fragments) leave them fixed. It is most useful when you are
adjusting an internal portion of a chain or ring and want the rest of the
molecule to stay put.

## Syntax
```
protect(selection='(all)', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to protect from editing transforms |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The selection is preprocessed and passed to `_cmd.protect(..., 1, quiet)` — the
`1` sets the protected flag. Protected atoms are excluded from editing-mode drags
and torsion moves but are otherwise unaffected (still selectable, colorable,
etc.). `deprotect` calls the same C function with `0` to clear the flag. This is
distinct from `mask`, which blocks picking rather than transformation.

## Examples
```
protect resi 50-60
protect
deprotect
```

## Related
- `deprotect`, `mask`, `unmask`, `mouse` - editing controls

## Source
`packages/engine/modules/pymol/editing.py:2763`. Registered in the TS port at
`packages/engine-ts/src/cmd/editing.ts:416`.
