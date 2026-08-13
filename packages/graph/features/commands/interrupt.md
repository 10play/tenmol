---
name: interrupt
kind: command
category: control-flow-system
subcategory: execution control
summary: Signals the engine to interrupt a running operation (asynchronous, no locking).
parity: internal
---

## Purpose
`interrupt` asynchronously signals the C layer to abort a long-running operation (e.g. ray tracing or a sculpting loop). It is a low-level control hook rather than a routine scripting command.

## Syntax
`interrupt()`

Takes no user arguments.

## Behaviour
Defined at module scope (not on the `cmd` object) and deliberately does no locking — it calls `_cmd.interrupt(_self._COb, 1)` directly so it can fire while another thread holds the lock. Marked `# asynch -- no locking!` in the source.

## Examples
```python
cmd.interrupt()
```

## Related
- [ray](../commands/ray.md)

## Source
`packages/engine/modules/pymol/locking.py:88`. Parity: internal — no dedicated command in `packages/engine-ts/src`.
