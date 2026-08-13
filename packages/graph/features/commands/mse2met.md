---
name: mse2met
kind: command
category: editing-building
subcategory: residue mutation
summary: Mutates selenomethionine (MSE) residues to methionine (MET).
parity: implemented
---

## Purpose
`mse2met` converts selenomethionine residues to ordinary methionine, a common
cleanup step when a crystal structure used SeMet for phasing but you want a
standard MET model. It renames the selenium atom to sulfur and reclassifies the
residue.

## Syntax
```
mse2met(selection='all', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | atoms to consider |
| `quiet` | int | `1` | suppress the count message |

## Behaviour
Within the selection it (1) alters `MSE/SE` atoms to `name="SD"`, `elem="S"`;
(2) clears the `ignore` flag on `resn MSE` atoms so they are treated as normal;
and (3) alters `resn MSE` to `resn="MET"`, `type="ATOM"`. When `quiet=0` it
prints `Altered N MSE residues to MET`. It edits atom identity in place - it does
not add hydrogens or adjust geometry.

## Examples
```
mse2met
mse2met chain A, quiet=0
```

## Related
- `alter`, `flag` - the underlying editing primitives it composes

## Source
`packages/engine/modules/pymol/editing.py:3031`. Registered in the TS port at
`packages/engine-ts/src/cmd/extras.ts:232`.
