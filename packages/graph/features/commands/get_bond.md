---
name: get_bond
kind: command
category: settings
subcategory: per-bond setting query
summary: Returns per-bond setting values for all bonds between two atom selections.
parity: implemented
---

## Purpose
`get_bond` reads a per-bond setting for every bond that exists between two atom selections. It is the read counterpart to [set_bond](../commands/set_bond.md); reach for it to inspect bond-level overrides like `stick_radius` or `stick_transparency`.

## Syntax
`get_bond(name, selection1, selection2=None, state=0, updates=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Setting name |
| `selection1` | str | — | First set of atoms |
| `selection2` | str | `None` | Second set of atoms; defaults to `(selection1)` |
| `state` | int | `0` | State number |
| `updates` | 0/1 | `1` | Whether to trigger scene updates |
| `quiet` | 0/1 | `1` | Verbosity |

## Behaviour
Only settings that are actually meaningful at the bond level return useful values. The currently implemented per-bond settings are: `valence`, `line_width`, `line_color`, `stick_radius`, `stick_color`, and `stick_transparency`. Other settings may appear to be recognized but have no effect at the per-bond level. When `selection2` is omitted it defaults to `selection1`, so bonds are found within a single selection.

## Examples
```python
get_bond stick_transparency, */n+c+ca+o
get_bond stick_radius, resi 10, resi 11
```

## Related
- [set_bond](../commands/set_bond.md)
- [get](../commands/get.md)

## Source
Upstream `packages/engine/modules/pymol/setting.py:449`. Parity: implemented — registered as `ctx.command('get_bond')` in `packages/engine-ts/src/cmd/misc.ts:275`.
