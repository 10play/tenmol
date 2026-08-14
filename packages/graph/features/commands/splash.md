---
name: splash
kind: command
category: ui-gui
subcategory: splash screen
summary: Shows the PyMOL splash screen / startup information.
parity: implemented
---

## Purpose
`splash` displays the PyMOL splash screen information. It is normally invoked
automatically at startup, but can be called to re-show the splash graphic or to
query which build variant is running.

## Syntax
`splash(mode=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | int | `0` | `0` = show textual splash in the internal feedback area; `1` = display the splash PNG; `2` = query build type. |

## Behaviour
With `mode=0` and `internal_feedback > 0`, the text splash is enabled. `mode=1`
loads and displays the appropriate splash PNG for the build (open-source,
evaluation, edu, or incentive) on a background thread. `mode=2` returns an
integer identifying the build variant without displaying anything.

## Examples
```
splash
```

## Related
- [feedback](../commands/feedback.md)

## Source
`packages/engine/modules/pymol/commanding.py:297`. Parity: implemented — the
headless TS engine registers it as a no-op in
`packages/engine-ts/src/cmd/system.ts:127` (no splash surface to render).
