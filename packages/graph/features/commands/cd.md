---
name: cd
kind: command
category: control-flow-system
subcategory: shell / filesystem
summary: Changes the current working directory.
parity: partial
---

## Purpose
`cd` changes PyMOL's current working directory, affecting where relative file
paths for `load`, `save`, `png`, etc. resolve. It mirrors the shell `cd`.

## Syntax
`cd(dir='~', complain=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dir` | str | `'~'` | Target directory; `~` expands to the home directory. |
| `complain` | int | `1` | If set, raise on failure; otherwise fail silently. |
| `quiet` | int | `1` | Suppress the "now in ..." message when set. |

## Behaviour
`dir` is expanded via `exp_path` (so `~` and environment variables are honored)
and passed to `os.chdir`, which raises on error. When `complain` is truthy a
failed change is re-raised as a `CmdException`; when falsy the error is swallowed
and the directory is left unchanged. With `quiet=0` it prints the new working
directory. Always returns success.

## Examples
```
cd ~/Documents/structures
cd ..
cd
```

## Related
- [pwd](../commands/pwd.md)
- [ls](../commands/ls.md)
- [system](../commands/system.md)

## Source
`packages/engine/modules/pymol/externing.py:32`. In the TS port `cd` is
registered as a no-op (`() => null`) since the browser engine has no OS working
directory (`packages/engine-ts/src/cmd/system.ts`).
