---
name: unblock_flush
kind: command
category: control-flow-system
subcategory: api locking
summary: Internal helper that re-enables flushing of the command queue when the API lock is released.
parity: internal
---

## Purpose
`unblock_flush` is an internal locking helper, not a user command. It sets the
flag that permits the command queue to be flushed the next time the API lock is
released, undoing a prior "block flush" state used to batch operations under a
held lock.

## Syntax
`unblock_flush(_self=cmd)`

## Behaviour
Under the API lock context manager it sets `lock_api_allow_flush = 1`. When the
lock is later released by `unlock`, a GUI-thread caller with this flag set calls
`_cmd.flush_now`, actually draining the queued core commands. It pairs with the
block/unblock mechanism that lets a caller hold the lock across several commands
without intermediate flushes. There is no return value.

## Examples
```python
# internal plumbing, not a command-line verb
cmd.unblock_flush()   # allow the next unlock to flush the queue
```

## Related
- [LockCM](../commands/LockCM.md)
- [sync](../commands/sync.md)

## Source
`packages/engine/modules/pymol/locking.py:36`. Parity: internal — locking plumbing
with no counterpart in the single-threaded `packages/engine-ts/src` engine.
