---
name: angle
kind: command
category: measurement
subcategory: angle measurement
summary: Creates a measurement object showing the angle formed between three atoms.
parity: implemented
---

## Purpose
`angle` displays the angle formed between any three atoms as a labelled measurement object in the scene. Called with no selections it uses the picked atoms (pk1, pk2, pk3) set via Ctrl-middle-click, making it the interactive way to read a bond/geometry angle.

## Syntax
`angle(name=None, selection1='(pk1)', selection2='(pk2)', selection3='(pk3)', mode=None, label=1, reset=0, zoom=0, state=0, quiet=1, state1=-3, state2=-3, state3=-3)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `None` | Measurement object name (auto `angleNN` if omitted) |
| `selection1` | selection | `'(pk1)'` | First atom |
| `selection2` | selection | `'(pk2)'` | Vertex atom |
| `selection3` | selection | `'(pk3)'` | Third atom |
| `mode` | int | `None` | Angle mode (defaults to 0) |
| `label` | 0/1 | `1` | Show the numeric label |
| `reset` | 0/1 | `0` | Reset an existing object of this name |
| `zoom` | 0/1 | `0` | Zoom to the measurement |
| `state` | int | `0` | State (0 = all/current per settings) |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `state1`/`state2`/`state3` | int | `-3` | Per-selection state overrides |

## Behaviour
If a `(pkN)` default is used but that pick selection is undefined, it prints a `cmd-Error: The 'pkN' selection is undefined.` and fails. When `name` is omitted it increments the `dist_counter` setting to auto-name `angleNN`. Each selection is run through `selector.process`; unless a selection equals `"same"` it is wrapped in parentheses. The state is decremented to zero-based for the `_cmd.angle` core call. The result is a persistent measurement object (like `distance`/`dihedral`).

## Examples
```python
angle                          # angle across the three picked atoms
angle a1, 4/n, 4/ca, 4/c       # named angle at the CA vertex
```

## Related
- [distance](../commands/distance.md)
- [dihedral](../commands/dihedral.md)
- [get_angle](../commands/get_angle.md)
- [auto_measure](./auto_measure.md)

## Source
`packages/engine/modules/pymol/querying.py:200`. Parity: implemented in `packages/engine-ts/src/cmd/dashes.ts`.
