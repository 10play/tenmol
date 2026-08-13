---
name: get_vis
kind: command
category: representations-display
subcategory: visibility snapshot
summary: Return an opaque snapshot of the current visibility state of all objects.
parity: implemented
---

## Purpose
`get_vis` captures the full visibility/representation on-off state of the scene
as an opaque structure that can later be restored with `set_vis`. It underpins
scene storage of what is shown vs hidden without re-issuing `show`/`hide`.

## Syntax
`get_vis()`

Takes no arguments.

## Behaviour
Returns an engine-defined dictionary/structure keyed by object describing which
representations are enabled and which objects are visible. The value is meant to
be round-tripped through `set_vis` rather than inspected directly.

## Examples
```python
saved = cmd.get_vis()
cmd.hide("everything")
cmd.set_vis(saved)   # restore
```

## Related
- [set_vis](set_vis.md), [show](show.md), [hide](hide.md)

## Source
`packages/engine/modules/pymol/viewing.py:899`. Parity: implemented — present in
`packages/engine-ts/src/cmd/display.ts`.
