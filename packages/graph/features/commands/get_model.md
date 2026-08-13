---
name: get_model
kind: command
category: querying
subcategory: atom data extraction
summary: Returns a ChemPy Indexed model (atoms, coords, bonds) for a selection.
parity: implemented
---

## Purpose
`get_model` extracts a full ChemPy "Indexed" model object from a selection: per-atom properties, coordinates for one state, and bond connectivity. It is the primary way to pull structured atom data out of PyMOL into Python for analysis or manipulation.

## Syntax
`get_model(selection='(all)', state=1, ref='', ref_state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to extract |
| `state` | int | `1` | Coordinate state to read (1-based) |
| `ref` | str | `''` | Optional reference object for a coordinate frame transform |
| `ref_state` | int | `0` | Reference state (1-based; `0` = all) |

## Behaviour
The selection is processed via `selector.process` and wrapped in parentheses, then `_cmd.get_model` is called with zero-based `state-1` and `ref_state-1`. Returns a `chempy.models.Indexed` with `.atom` and `.bond` lists. When `ref` is given, coordinates are returned in that reference object's frame. Note the different default state (`1`) versus other queries that default to current/all.

## Examples
```python
m = cmd.get_model("chain A and name CA")
for a in m.atom:
    print(a.resn, a.resi, a.coord)
```

## Related
- [get_bonds](../commands/get_bonds.md)
- [iterate_state](../commands/iterate_state.md)
- [get_coords](../commands/get_coords.md)

## Source
`packages/engine/modules/pymol/querying.py:1060`. Parity: implemented; model construction in `packages/engine-ts/src/model/molecule.ts`.
