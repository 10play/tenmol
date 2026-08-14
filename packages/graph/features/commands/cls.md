---
name: cls
kind: command
category: control-flow-system
subcategory: output buffer
summary: Clears the text output buffer.
parity: partial
---

## Purpose
`cls` clears PyMOL's text output buffer (the on-screen feedback / console text),
analogous to a terminal `clear`. Reach for it to tidy the display before a
demonstration or screenshot.

## Syntax
`cls()`

This command takes no user-facing parameters.

## Behaviour
Acquires the API lock and calls `_cmd.cls`, which empties the internal output
buffer. It does not affect loaded objects, the scene, or any settings — only the
displayed text feedback.

## Examples
```
cls
```

## Related
- [feedback](../commands/feedback.md)
- [system](../commands/system.md)

## Source
`packages/engine/modules/pymol/commanding.py:231`. In the TS port `cls` is a
registered no-op accepted for compatibility (there is no server-side text buffer
to clear; `packages/engine-ts/src/cmd/extras.ts`).
