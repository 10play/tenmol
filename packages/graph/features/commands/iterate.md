---
name: iterate
kind: command
category: querying
subcategory: atom iteration
summary: Evaluate a read-only Python expression once per atom in a selection within a temporary namespace.
parity: implemented
---

## Purpose
The primary way to pull per-atom data out of a structure or to accumulate statistics. `iterate`
runs an expression for every atom, exposing that atom's properties as local names — without
modifying anything (it is the read-only counterpart of `alter`).

## Syntax
`iterate(selection, expression=None, quiet=1, space=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | — | atoms to iterate over |
| `expression` | string / callable | `None` | Python expression (or, since 2.5, a callable taking an `atom`) run per atom |
| `quiet` | int | `1` | suppress feedback |
| `space` | dict | `None` | namespace in which the expression is evaluated (defaults to `pymol` globals) |

## Behaviour
Atom properties (`name, resi, resn, chain, b, q, partial_charge, index, ID, ss, elem, …`) are
available as read-only local names. Unlike `alter`, assignments to those atomic properties do not
persist — only side effects on objects reachable through `space` (e.g. `stored`) survive. If
`expression` is `None`, a `functools.partial` is returned (curried form). The selection is
preprocessed and the work is done via `_cmd.alter(..., read_only=True)`.

## Examples
```python
stored.charges = []
iterate all, stored.charges.append(partial_charge)

# callable form (PyMOL 2.5+)
names = []
cmd.iterate("name CA", lambda atom: names.append(atom.name))
```

## Related
[iterate_state](iterate_state.md), alter, alter_state, [label](label.md)

## Source
`packages/engine/modules/pymol/editing.py:1773`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/analysis.ts:302`).
