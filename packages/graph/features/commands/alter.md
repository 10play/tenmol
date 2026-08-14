---
name: alter
kind: command
category: editing-building
subcategory: atom properties
summary: Changes atomic properties by evaluating a Python expression once per selected atom.
parity: implemented
---

## Purpose
`alter` mutates atom-level properties (name, chain, b-factor, colour, ss, etc.) by running a Python expression in a temporary namespace for each atom in a selection. It is the primary tool for editing atomic metadata programmatically without touching coordinates (use `alter_state` for coordinates).

## Syntax
`alter(selection, expression, quiet=1, space=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | — | Atoms to modify |
| `expression` | str | — | Python statement evaluated per atom |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `space` | dict | `None` | Namespace made available to the expression |

## Behaviour
For each atom the expression sees a set of symbols: writable `name, resn, resi, resv, chain, segi, elem, alt, q, b, vdw, type, partial_charge, formal_charge, elec_radius, text_type, label, numeric_type, ID, rank, color, ss, cartoon, flags` and read-only `model, state, index`. All strings must be explicitly quoted. Custom names can be injected via `space`. After changing properties that affect canonical atom ordering (names, chains, etc.) you must run `sort`, or subsequent `create`/`byres` operations will be confounded; representations may need `rebuild`. The call runs under the API lock via `_cmd.alter(..., read_only=False, ...)`.

## Examples
```python
alter chain A, chain='B'
alter all, resi=str(int(resi)+100)
sort
```

## Related
- [alter_state](./alter_state.md)
- [iterate](../commands/iterate.md)
- [sort](../commands/sort.md)

## Source
`packages/engine/modules/pymol/editing.py:1708`. Parity: implemented in `packages/engine-ts/src/cmd/analysis.ts` (expression compiled to JS rather than Python `eval`).
