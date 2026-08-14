---
name: get_viewport
kind: command
category: viewing-camera
subcategory: viewport size
summary: Return (and optionally print/log) the screen viewport width and height.
parity: implemented
---

## Purpose
`get_viewport` reports the current rendering viewport size in pixels as
`(width, height)`. Use it to read the drawable area before sizing output or
computing aspect ratios.

## Syntax
`get_viewport(output=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `output` | int | `1` | `0` = do not print; `1` = print to screen if not logging and not quiet; `2` = force print even if logging |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
Returns a `(w, h)` tuple. When the `logging` setting is on and `output < 3` it
writes a `viewport w, h` line to the log file; if `output < 2` screen echo is
then suppressed. With `0 < output < 3` and `quiet=0` it prints a cut-and-paste
`viewport` script block. `output=3` is deprecated (warns) and returns a
formatted string.

## Examples
```python
w, h = cmd.get_viewport()
aspect = w / h
```

## Related
- [viewport](viewport.md), [get_view](get_view.md)

## Source
`packages/engine/modules/pymol/viewing.py:853`. Parity: implemented — present in
`packages/engine-ts/src/cmd/render.ts`.
