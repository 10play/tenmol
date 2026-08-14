---
name: callout
kind: command
category: labeling
subcategory: callout
summary: Creates a screen-stabilized callout (labeled arrow) object.
parity: planned
---

## Purpose
`callout` creates a new screen-stabilized callout object: a text label,
optionally anchored to a point in model space by an arrow, that stays fixed in
screen position. It is used to annotate figures with pointers to atoms or
regions.

## Syntax
`callout(name, label, pos='', screen='auto', state=-1, color='front', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name. |
| `label` | str | — | Label text. |
| `pos` | str/list | `''` | Anchor in model space as a 3-float coord list or atom selection; empty means draw no arrow. |
| `screen` | str/list | `'auto'` | Screen position as a 2-float list in `[-1,-1]`..`[1,1]`, or `'auto'` for smart placement. |
| `state` | int | `-1` | Object state. |
| `color` | str | `'front'` | Callout color. |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
In upstream open-source PyMOL this command raises `IncentiveOnlyException` — it
is only functional in the commercial Incentive build. When `pos` is empty no
arrow is drawn (label only); otherwise the arrow points from the screen-anchored
label to the model-space anchor. `screen='auto'` requests automatic
non-overlapping placement.

## Examples
```
callout note1, "active site", pos=resi 145, color=yellow
callout title, "Figure 1", screen=[-0.9, 0.9]
```

## Related
- [label](../commands/label.md)
- [pseudoatom](../commands/pseudoatom.md)

## Source
`packages/engine/modules/pymol/experimenting.py:246` (raises
`IncentiveOnlyException`). Registered as an accepted no-op in
`packages/engine-ts/src/cmd/extras.ts`.
