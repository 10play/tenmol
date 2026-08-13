---
name: lock_without_glut
kind: command
category: internal
subcategory: api locking
summary: Internal helper that acquires the API lock while already holding the GLUT/GUI lock, avoiding deadlock.
parity: internal
---

## Purpose
`lock_without_glut` acquires PyMOL's API lock from a context that must first hold the
GLUT/GUI lock, ordering the two locks correctly to avoid deadlock. It is internal
threading plumbing, not a user command.

## Syntax
`lock_without_glut(_self=cmd)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `_self` | cmd | `cmd` | the PyMOL command instance to lock |

## Behaviour
It enters `_self.lock_api_glut` (`with _self.lock_api_glut:`) and, while holding it,
calls [lock](lock.md) to take the API lock. This enforces a consistent lock
acquisition order between the GUI/GLUT lock and the API lock. Marked as an internal
routine subject to change.

## Examples
```python
# Internal — used by the GUI event path, not user scripts.
cmd.lock_without_glut(cmd)
```

## Related
- [lock](lock.md) — plain API-lock acquire
- [lock_attempt](lock_attempt.md) — non-blocking acquire

## Source
`packages/engine/modules/pymol/locking.py:11` (`def lock_without_glut`, WARNING:
internal). Not ported as a command in `packages/engine-ts/src`.
