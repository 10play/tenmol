---
name: usalign
kind: command
category: fitting-alignment
subcategory: structural superposition
summary: TM-align structural superposition of two structures using length-independent TM-score optimization.
parity: implemented
---

## Purpose
`usalign` superposes a mobile structure onto a target using the USalign/TM-align algorithm, which optimizes the TM-score rather than RMSD. Because TM-score is length-independent, it is better suited than `align`/`super` for comparing proteins of different lengths or low sequence identity. Only guide atoms (CA of proteins, C4' of nucleic acids) participate.

## Syntax
`usalign(mobile, target, mobile_state=1, target_state=1, quiet=1, transform=1, object=None, fast=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | str | — | atom selection of the mobile object |
| `target` | str | — | atom selection of the target object |
| `mobile_state` | int | `1` | object state of the mobile selection |
| `target_state` | int | `1` | object state of the target selection |
| `quiet` | int | `1` | suppress feedback |
| `transform` | int | `1` | apply the superposition transform to the mobile object |
| `object` | str \| None | `None` | name of an alignment object to create |
| `fast` | int | `0` | use fast mode with fewer iterations |

## Behaviour
Selections are processed and passed to `_cmd.usalign` with 0-based states. Only guide atoms (CA / C4') are used regardless of the selection given. The returned TM-score ranges 0–1 (1 = perfect); values above ~0.5 generally indicate the same fold. With `transform=1` the mobile object is moved onto the target; `object` creates a named alignment object linking the matched residues. `fast=1` trades accuracy for speed. Based on the USalign algorithm by Zhang & Skolnick.

## Examples
```python
fetch 1rlw 1rsy, async=0
usalign 1rsy, 1rlw

usalign protA, protB, object=aln
```

## Related
- [align](../commands/align.md)
- [super](../commands/super.md)
- [cealign](../commands/cealign.md)
- [pair_fit](../commands/pair_fit.md)
- [fit](../commands/fit.md)

## Source
`packages/engine/modules/pymol/fitting.py:137`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts`.
