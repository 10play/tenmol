---
name: LockCM
kind: command
category: control-flow-system
subcategory: api locking
summary: Context manager that acquires and releases PyMOL's API lock around a block of code.
parity: internal
---

## Purpose
`LockCM` is the "API lock context manager" used internally to serialise access to the PyMOL core from Python. Nearly every API method wraps its `_cmd.*` call in `with _self.lockcm:` so that concurrent threads never enter the core simultaneously. It is not a user command; it is the plumbing that makes the `cmd` API thread-safe.

## Syntax
`LockCM(_self=cmd)` — instantiated as `cmd.lockcm` and used as `with _self.lockcm: ...`.

## Behaviour
On `__enter__` it calls `lock(self.cmd)` (acquiring `lock_api`); on `__exit__` it calls `unlock(...)`, passing `-1` if an exception propagated so the command queue is flushed with an error result, or `None` on clean exit. It holds a weakref proxy to the owning `cmd` instance to avoid reference cycles. There are no parameters to tune and no return value beyond the managed block.

## Examples
```python
# internal usage pattern, not a command-line verb
with cmd.lockcm:
    return _cmd.add_bond(cmd._COb, oname, i1, i2, order)
```

## Related
- [async_](./async_.md)
- [accept](./accept.md)

## Source
`packages/engine/modules/pymol/locking.py:15`. Parity: internal — the TypeScript port does not expose a Python-style lock context manager; single-threaded engine handles serialisation implicitly.
