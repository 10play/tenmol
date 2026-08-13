---
name: lock
kind: command
category: internal
subcategory: api locking
summary: Internal helper that acquires PyMOL's API lock to serialise access to the C layer.
parity: internal
---

## Purpose
`lock` is an internal, blocking helper that acquires PyMOL's global API lock. It is
not meant for end users; it guarantees that only one thread mutates the C-side
PyMOL instance at a time. Application code uses the `lockcm` context manager (which
calls `lock`/`unlock`) rather than calling this directly.

## Syntax
`lock(_self=cmd)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `_self` | cmd | `cmd` | the PyMOL command instance whose lock is taken |

## Behaviour
Returns `_self.lock_api.acquire()`, blocking until the lock is available. It is
paired with `unlock`, which releases the lock and flushes the command queue (unless
an error is pending). The `LockCM` context manager in the same module wraps this
pair; virtually every command body uses `with _self.lockcm:` instead of calling
`lock` explicitly. See [lock_attempt](lock_attempt.md) for the non-blocking variant
and [lock_without_glut](lock_without_glut.md) for the GUI-thread variant.

## Examples
```python
# Internal usage pattern (prefer the context manager):
cmd.lock(cmd)
try:
    ...
finally:
    cmd.unlock(0, cmd)
```

## Related
- [lock_attempt](lock_attempt.md) — non-blocking acquire
- [lock_without_glut](lock_without_glut.md) — acquire under the GLUT/GUI lock

## Source
`packages/engine/modules/pymol/locking.py:26` (`def lock`, marked INTERNAL). Not
ported as a command in `packages/engine-ts/src`.
