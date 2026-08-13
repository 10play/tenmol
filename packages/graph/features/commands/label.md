---
name: label
kind: command
category: labeling
subcategory: atom labels
summary: Label atoms in a selection by evaluating a per-atom Python expression that yields a string.
parity: implemented
---

## Purpose
Attach text labels to atoms, computing each label from atom properties via a Python expression.
The go-to command for annotating residues, chains, charges, or any per-atom value in the viewer.

## Syntax
`label(selection="(all)", expression="", quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | atoms to label |
| `expression` | string | `''` | Python expression convertible to a string, evaluated per atom |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Per-atom symbols available in the expression include: `name, resi, resn, resv, chain, segi, model,
alt, q, b, type, index, rank, ID, ss, vdw, elec_radius, label, elem, geom, flags, color, cartoon,
valence, formal_charge, partial_charge, numeric_type, text_type, stereo`. All string literals must
be explicitly quoted. Omitting `expression` (or setting it to `''`) clears existing labels.
Labelling can take several seconds per thousand atoms. The selection is preprocessed and the work
is done by `_cmd.label`.

## Examples
```python
label chain A, chain
label name CA, "%s-%s" % (resn, resi)
label resi 200, "%1.3f" % partial_charge
```

## Related
[label2](label2.md), [iterate](iterate.md), set (label_size, label_color)

## Source
`packages/engine/modules/pymol/viewing.py:1378`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/display.ts:210`).
