---
name: async_
kind: command
category: control-flow-system
subcategory: threading
summary: Runs a function on a background thread while showing a "please wait..." message.
parity: internal
---

## Purpose
`async_` executes a callable (or named command) on a daemon thread so that long-running work does not block the main loop, displaying a transient "please wait ..." message wizard while it runs. It underpins asynchronous loading (e.g. `fetch ..., async=1`).

## Syntax
`async_(func, *args, **kwargs)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `func` | callable or str | — | Function to run, or a command keyword name to resolve |
| `*args` / `**kwargs` | — | — | Passed through to `func` |

## Behaviour
It pushes a non-dismissable `Message(['please wait ...'])` wizard, resolves `func` via `keyword[func][0]` if it is a string, then starts a daemon `threading.Thread` whose wrapper: registers itself in `async_threads`, calls `func(*args, **kwargs)`, swallows `CmdException`/`QuietException` (printing them if they carry args), and finally removes the wait-message wizard and de-registers the thread. The trailing underscore in the name avoids clashing with Python's `async` keyword.

## Examples
```python
cmd.async_(cmd.load, "big.pdb")
cmd.async_("ray", 1600, 1200)
```

## Related
- [abort](./abort.md)
- [LockCM](./LockCM.md)

## Source
`packages/engine/modules/pymol/commanding.py:897`. Parity: internal — the single-threaded TypeScript engine has no Python-thread wrapper; no `async_` command is registered.
