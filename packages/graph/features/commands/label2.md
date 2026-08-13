---
name: label2
kind: command
category: labeling
subcategory: atom labels
summary: Variant of label that evaluates a per-atom expression to set atom labels via the label2 path.
parity: implemented
---

## Purpose
An alternate labelling entry point mirroring [label](label.md). It exists as a separate C dispatch
(`_cmd.label2`) used by the newer label-placement machinery; usage is identical to `label`.

## Syntax
`label2(selection="(all)", expression="", quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | atoms to label |
| `expression` | string | `''` | Python expression convertible to a string, evaluated per atom |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Undocumented in upstream (no docstring); the Python wrapper preprocesses the selection and calls
`_cmd.label2`. Per-atom symbols and the empty-expression-clears-labels behaviour match
[label](label.md). In the engine-ts port `label2` simply delegates to the `label` command.

## Examples
```python
label2 name CA, "%s%s" % (resn, resi)
```

## Related
[label](label.md), [iterate](iterate.md)

## Source
`packages/engine/modules/pymol/viewing.py:1424`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/misc2.ts:50`, delegating to `label`).
