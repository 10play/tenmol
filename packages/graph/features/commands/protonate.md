---
name: protonate
kind: command
category: editing-building
subcategory: hydrogen addition
summary: Adds hydrogens with pH-dependent protonation states from pKa values.
parity: implemented
---

## Purpose
`protonate` adds hydrogens according to titratable-residue protonation states at
a target pH, rather than blindly filling every open valence. Use it to build a
chemically reasonable model of a protein at a given pH (e.g. deprotonated
carboxylates, protonated lysines at pH 7.4).

## Syntax
```
protonate(selection='all', pH=7.4, ff='amber', state=0, quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | atoms to protonate |
| `pH` | float | `7.4` | target pH for protonation |
| `ff` | string | `'amber'` | pdb2pqr forcefield (amber, charmm, parse, ...) |
| `state` | int | `0` | coordinate state (0 = all states) |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
When pdb2pqr is available it uses PROPKA for per-residue pKa prediction that
accounts for the microenvironment; otherwise it falls back to textbook pKa values
(Asp 3.65, Glu 4.25, His 6.00, Cys 8.18, Tyr 10.07, Lys 10.53, Arg 12.48). Unlike
`h_add`, which fills all open valences, `protonate` uses those pKa values to
decide which atoms should carry hydrogens at the given pH. Heavy atoms and their
visual settings (colors, representations) are preserved; only hydrogens change.

## Examples
```
protonate
protonate polymer, pH=5.5
protonate all, pH=7.4, ff=charmm
```

## Related
- `h_add`, `h_fill` - unconditional hydrogen filling

## Source
`packages/engine/modules/pymol/editing.py:1444`. Registered in the TS port at
`packages/engine-ts/src/cmd/builder.ts:616`.
