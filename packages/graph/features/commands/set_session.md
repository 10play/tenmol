---
name: set_session
kind: command
category: file-io
subcategory: session
summary: Restores PyMOL state from an in-memory session object (the loader behind reading .pse files).
parity: implemented
---

## Purpose
`set_session` reinstates a complete PyMOL state — objects, views, settings, scenes, movie — from a session dictionary (or compressed bytes). It is the low-level counterpart of `get_session` and the mechanism `load` uses when opening a `.pse`/`.psw` file. Reach for it when you already hold a session object in Python.

## Syntax
`set_session(session, partial=0, quiet=1, cache=1, steal=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `session` | dict/bytes | — | Session object; `bytes` implies zlib-compressed pickled data |
| `partial` | int | `0` | Restore only part of the session (do not reset everything) |
| `quiet` | int | `1` | Suppress feedback |
| `cache` | int | `1` | Restore the render cache stored in the session |
| `steal` | int | `-1` | Take ownership of session sub-dicts instead of deep-copying; -1 = auto (1 for bytes input, 0 otherwise) |

## Behaviour
Byte input is zlib-decompressed and unpickled first, and defaults `steal` to 1. The core restore runs under a lock, then a list of registered `_session_restore_tasks` runs; each task is attempted even if a prior one fails, and a `CmdException` is raised at the end if any failed. `steal` avoids expensive deep copies by moving the `session`/`cache` sub-dicts out of the input. If the restored movie contains commands, the `security` wizard is activated automatically.

## Examples
```python
s = cmd.get_session()
cmd.reinitialize()
cmd.set_session(s)
```

## Related
- [get_session](./get_session.md)
- [load](./load.md)
- [reinitialize](./reinitialize.md)

## Source
`packages/engine/modules/pymol/importing.py` (`def set_session`); signature in `docs/api-reference/commands.mdx:3693`. Parity: implemented in `packages/engine-ts/src/cmd/exporters.ts`.
