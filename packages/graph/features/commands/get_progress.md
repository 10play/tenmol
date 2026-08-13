---
name: get_progress
kind: command
category: control-flow-system
subcategory: task monitoring
summary: Return the fractional progress of a long-running task, optionally resetting the tracker.
parity: unknown
---

## Purpose
`get_progress` reports the completion fraction of the current long-running task
(e.g. a ray trace or surface computation) for driving progress bars. It reads the
engine's task-status monitor rather than a specific command's return value.

## Syntax
`get_progress(reset=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `reset` | int | `0` | If true, reset the progress tracker after reading |

## Behaviour
Acquires the `lock_api_status` lock and calls the C-layer `get_progress`,
returning a float in `[0, 1]` (or a negative sentinel when no task is running).
Uses the status lock rather than the main API lock so it can be polled while a
task holds the main lock.

## Examples
```python
frac = cmd.get_progress()
cmd.get_progress(reset=1)
```

## Related
- [get_renderer](get_renderer.md)

## Source
`packages/engine/modules/pymol/monitoring.py:5`. Parity: unknown — not registered
in `packages/engine-ts/src`.
