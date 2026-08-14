---
name: read_mmodstr
kind: command
category: file-io
subcategory: in-memory load
summary: Load a MacroModel-format structure from an in-memory Python string, no temp file.
parity: unknown
---

## Purpose
`read_mmodstr` loads a MacroModel (`.mmod`) format structure directly from a
Python string instead of a file on disk. Use it from API/bridge code to inject
structures without touching the filesystem.

## Syntax
`read_mmodstr(content, name, state=0, quiet=1, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `content` | string | | the MacroModel structure text |
| `name` | string | | object name to create/append into |
| `state` | integer | `0` | 1-based state index, or 0 to append |
| `quiet` | | `1` | suppress feedback |
| `zoom` | | `-1` | auto-zoom behaviour (-1 = use setting) |

## Behaviour
Forwards to the shared `_cmd.load` path with `loadable.mmodstr`, converting the
1-based `state` to the engine's 0-based index. Unlike the other `read_*str`
loaders it hardcodes `finish=1` and `discrete=1` (no overlapping atoms), so the
loaded object is finished immediately and cannot be edited.

## Examples
```
# API usage
cmd.read_mmodstr(open('lig.mmod').read(), 'lig')
```

## Related
- [read_molstr](../commands/read_molstr.md)
- [read_pdbstr](../commands/read_pdbstr.md)

## Source
`packages/engine/modules/pymol/importing.py:995` (`def read_mmodstr`). Parity:
not registered as a command in `packages/engine-ts/src`.
