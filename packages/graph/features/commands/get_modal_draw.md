---
name: get_modal_draw
kind: command
category: internal
subcategory: render loop
summary: Returns whether a modal (multi-pass) draw is pending in the render loop.
parity: internal
---

## Purpose
`get_modal_draw` is a low-level render-loop introspection helper that reports whether PyMOL currently has a modal draw pending (a multi-pass operation such as ray tracing or a draw sequence that must complete over successive frames). It is used internally by the display/refresh machinery, not typically by scripts.

## Syntax
`get_modal_draw(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | 0/1 | `1` | Feedback flag (keyword-only) |

## Behaviour
Locks the command layer and returns `_cmd.get_modal_draw`, an integer/boolean indicating a pending modal draw. `quiet` is accepted as a keyword-only argument. No engine docstring is present.

## Examples
```python
pending = cmd.get_modal_draw()
```

## Related
- [refresh](../commands/refresh.md)
- [draw](../commands/draw.md)

## Source
`packages/engine/modules/pymol/querying.py:79`. Parity: internal render-loop helper; no TypeScript port found.
