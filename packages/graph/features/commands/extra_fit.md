---
name: extra_fit
kind: command
category: fitting-alignment
subcategory: multi-object superposition
summary: Superposes multiple objects onto one reference object using a chosen alignment method.
parity: implemented
---

## Purpose
`extra_fit` is like `intra_fit` but across multiple objects instead of multiple states: it fits every object in a selection onto a reference object using a configurable alignment command (`align`, `super`, `cealign`, …). Reach for it to overlay a family of related structures in one call.

## Syntax
`extra_fit(selection='(all)', reference='', method='align', zoom=1, quiet=0, **kwargs)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atom selection spanning multiple objects |
| `reference` | str | `''` | Reference object name; default = first object in the selection |
| `method` | str/callable | `'align'` | Alignment command taking `mobile`/`target` (e.g. align, super, cealign) |
| `zoom` | 0/1 | `1` | Zoom after fitting |
| `quiet` | 0/1 | `0` | Suppress the per-object RMSD printout |
| `**kwargs` | — | — | Extra arguments forwarded to `method` |

## Behaviour
It creates a temporary selection, enumerates objects via `get_object_list`, and picks the reference (first object, or the named one, adding it to the temp selection if it lies outside). String `method` names are resolved through the command keyword table (else raises "Unknown method"). For each remaining object it calls `method(mobile='?tmp & ?obj', target='?tmp & ?ref', **kwargs)` and, unless quiet, prints `<object> RMSD = <value> (<n> atoms)`, handling scalar, sequence, and dict result shapes.

## Examples
```python
extra_fit name CA, 1ubq, super
extra_fit (chain A), reference=refobj, method=cealign
```

## Related
- [intra_fit](../commands/intra_fit.md)
- [align](./align.md)
- [super](../commands/super.md)
- [cealign](../commands/cealign.md)

## Source
`packages/engine/modules/pymol/fitting.py:203`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts:660`.
