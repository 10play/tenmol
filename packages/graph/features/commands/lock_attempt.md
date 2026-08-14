---
name: lock_attempt
kind: command
category: internal
subcategory: api locking
summary: Internal non-blocking helper that tries to acquire PyMOL's API lock and returns immediately.
parity: internal
---

## Purpose
`lock_attempt` is the non-blocking counterpart to [lock](lock.md): it tries to grab
PyMOL's API lock and returns right away with success/failure instead of waiting. It
is internal plumbing used where blocking on the lock would be undesirable.

## Syntax
`lock_attempt(_self=cmd)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `_self` | cmd | `cmd` | the PyMOL command instance whose lock is attempted |

## Behaviour
Returns `_self.lock_api.acquire(blocking=0)` — truthy if the lock was obtained,
falsy if it was already held by another thread. The caller is responsible for
releasing via `unlock` only when the acquire succeeded. Internal, subject to change.

## Examples
```python
if cmd.lock_attempt(cmd):
    try:
        ...
    finally:
        cmd.unlock(0, cmd)
```

## Related
- [lock](lock.md) — blocking acquire
- [lock_without_glut](lock_without_glut.md) — GUI-thread acquire

## Source
`packages/engine/modules/pymol/locking.py:29` (`def lock_attempt`, marked INTERNAL).
Not ported as a command in `packages/engine-ts/src`.
