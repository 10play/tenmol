---
name: vdw_fit
kind: command
category: editing-building
subcategory: van der Waals fitting
summary: Unsupported/experimental feature that fits van der Waals radii between two selections.
parity: partial
---

## Purpose
`vdw_fit` is an explicitly unsupported, experimental feature that adjusts van der Waals radii to fit the atoms of one selection against another within a buffer. It is not intended for general use and is documented here only for completeness.

## Syntax
`vdw_fit(selection1, selection2, state1=1, state2=1, buffer=0.24, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection1` | selection | — | first selection |
| `selection2` | selection | — | second selection |
| `state1` | int | `1` | state of the first selection |
| `state2` | int | `1` | state of the second selection |
| `buffer` | float | `0.24` | clearance buffer used in the fit |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The upstream docstring reads simply "`vdw_fit` is an unsupported feature." Both selections are processed and forwarded (with 0-based states) to `_cmd.vdw_fit(_COb, sel1, state1-1, sel2, state2-1, buffer, quiet)`. Behaviour is not guaranteed and may change or be removed.

## Examples
```python
# unsupported — provided for completeness only
vdw_fit sele_a, sele_b
```

## Related
- [set](../commands/set.md)
- [alter](../commands/alter.md)

## Source
`packages/engine/modules/pymol/editing.py:2957`. Parity: registered as a documented no-op in `packages/engine-ts/src/cmd/extras.ts`.
