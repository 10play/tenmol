---
name: unlock
kind: command
category: internal
subcategory: API locking
summary: Internal helper that releases the API lock and flushes the command queue.
parity: internal
---

## Purpose
`unlock` is an internal concurrency primitive, not a user-facing command. It releases PyMOL's API lock previously taken by `lock`, then flushes the pending command queue so queued work runs. Command wrappers call it in their `finally` blocks; scripts should never call it directly.

## Syntax
`unlock(result=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `result` | any | `None` | the wrapped call's return/status; a negative value signals an incipient error and suppresses the queue flush |

## Behaviour
It releases `lock_api`. On the GUI thread it also reaps the launcher thread (quitting the C object in no-gui mode when the reaper has died — see PYMOL-3247). If `result` is a negative number it treats that as an in-progress error and skips the flush so the bad state is not propagated. Marked `# INTERNAL` in the source and paired one-to-one with `lock`.

## Examples
```python
# internal pattern inside command wrappers — not for scripts
_self.lock(_self)
try:
    r = _cmd.some_op(_self._COb, ...)
finally:
    _self.unlock(r, _self)
```

## Related
- [lock](../commands/lock.md)
- [unblock_flush](../commands/unblock_flush.md)

## Source
`packages/engine/modules/pymol/locking.py:40` (marked `# INTERNAL`). Parity: internal helper, not exposed as a registered command in `packages/engine-ts`.
