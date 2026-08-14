---
name: sync
kind: command
category: control-flow-system
subcategory: command synchronization
summary: API-only barrier that blocks until all queued commands have finished executing, with a timeout.
parity: implemented
---

## Purpose
`sync` is an API-only function that waits for the command queue and deferred
tasks to drain before returning. It is used in scripts to guarantee that
asynchronous work (loads, renders, threaded commands) has completed before the
next step runs.

## Syntax
`sync(timeout=1.0, poll=0.05)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `timeout` | float | `1.0` | Maximum seconds to wait; a negative value waits indefinitely. |
| `poll` | float | `0.05` | Polling interval (seconds) between queue checks. |

## Behaviour
It first joins any tracked async threads, then loops on `wait_queue` until the
queue is empty or the timeout elapses (emitting a warning on timeout). It then
handles deferred display tasks: on the GUI thread it refreshes, otherwise it
waits on `wait_deferred`. Because it blocks, it must not be called from the GUI
thread's own command execution path.

## Examples
```python
cmd.load("big.pdb")
cmd.sync()          # block until the load is fully processed
cmd.sync(5.0)       # wait up to 5 seconds
```

## Related
- [frame](../commands/frame.md)
- [refresh](../commands/refresh.md)

## Source
`packages/engine/modules/pymol/commanding.py:382`. Parity: implemented — the
single-threaded TS engine registers it as an immediate no-op in
`packages/engine-ts/src/cmd/system.ts:126` (nothing to wait on).
