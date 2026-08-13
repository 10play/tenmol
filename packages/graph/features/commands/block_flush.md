---
name: block_flush
kind: command
category: control-flow-system
subcategory: api locking
summary: Internal API-lock helper that suppresses command-queue flushing.
parity: internal
---

## Purpose
`block_flush` is an internal locking primitive. It clears the
`lock_api_allow_flush` flag so that subsequent `unlock` calls do not flush the
command queue to the GUI thread. It is paired with `unblock_flush`, which
re-enables flushing. Application code rarely calls this directly.

## Syntax
`block_flush()`

This command takes no user-facing parameters (only the internal `_self` handle).

## Behaviour
Acquires the API lock (`with _self.lockcm`) and sets
`_self.lock_api_allow_flush = 0`. While the flag is cleared, `unlock` will skip
its `flush_now` call, batching GUI updates until `unblock_flush` restores the
flag. This is used to coalesce rapid command sequences and avoid intermediate
redisplays. There is no return value of interest.

## Examples
```
block_flush
# ... issue many commands without intermediate GUI flushes ...
unblock_flush
```

## Related
- [unblock_flush](../commands/unblock_flush.md)

## Source
`packages/engine/modules/pymol/locking.py:32`. No standalone port in
`packages/engine-ts/src` — the TS engine has no GUI-thread command queue to
flush, so this helper is not modeled.
