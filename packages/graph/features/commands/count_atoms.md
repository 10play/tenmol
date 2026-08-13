---
name: count_atoms
kind: command
category: querying
subcategory: atom count
summary: Returns the number of atoms matching a selection.
parity: implemented
---

## Purpose
`count_atoms` returns how many atoms match a selection expression. It is the workhorse query for validating selections, guarding scripts (e.g. only act if atoms exist), and reporting composition.

## Syntax
`count_atoms(selection='(all)', quiet=1, state=0, domain='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atom selection to count |
| `quiet` | int | `1` | Suppress the "count_atoms: N atoms" print when `1` |
| `state` | int | `0` (ALL_STATES) | State to evaluate; `0` counts across all states |
| `domain` | str | `''` | Optional selection domain to restrict the count |

## Behaviour
Preprocesses the selection, creates a transient named selection `_count_tmp` (which it immediately deletes) and returns the count as an integer. `state` is passed through as `state-1` internally; `0` means all states. With `quiet=0` it prints the count. Returns `0` for an empty match, so it is safe to test truthiness in scripts.

## Examples
```python
count_atoms name CA
count_atoms polymer, quiet=0
count_atoms resn HOH, state=1
```

## Related
- [count_states](../commands/count_states.md)
- [select](../commands/select.md)

## Source
`packages/engine/modules/pymol/querying.py:1419` (`def count_atoms`). Ported: `packages/engine-ts/src/select/selector.ts:1038` and `packages/engine-ts/src/exec/executive.ts:198` (`countAtoms`).
