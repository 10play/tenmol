---
name: abort
kind: command
category: control-flow-system
subcategory: script control
summary: Abruptly terminates execution of the running PyMOL command script.
parity: implemented
---

## Purpose
`abort` immediately stops execution of the current PyMOL command script, skipping any remaining commands in the file. Reach for it inside a `.pml`/`.py` script to bail out cleanly when a precondition fails or a debugging checkpoint is reached.

## Syntax
`abort()` — takes no arguments.

## Behaviour
When encountered during script playback, `abort` halts the script without executing subsequent commands and returns `None`. It is a control-flow marker rather than an operation on the scene; it has no effect on loaded objects or settings. Contrast with `skip`, which delimits a block to bypass while continuing afterwards.

## Examples
```python
# stop the script here; later commands are not run
abort
color blue, all   # never executed
```

## Related
- [skip](../commands/skip.md)
- [async_](./async_.md)

## Source
`packages/engine/modules/pymol/helping.py:707`. Parity: implemented in `packages/engine-ts/src/cmd/controlflow.ts`.
