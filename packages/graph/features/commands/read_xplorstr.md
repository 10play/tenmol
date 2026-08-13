---
name: read_xplorstr
kind: command
category: maps-volumes
subcategory: in-memory load
summary: Load an XPLOR map from an in-memory Python string, bypassing temp files.
parity: unknown
---

## Purpose
`read_xplorstr` is an API-only loader that reads an XPLOR-format map from a Python
string. Use it from bridge/scripting code to load electron-density or other map
data without writing a temporary file.

## Syntax
`read_xplorstr(xplor, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `xplor` | string | | the XPLOR map text |
| `name` | string | | map object name |
| `state` | integer | `0` | 1-based state index, or 0 to append |
| `finish` | 0/1 | `1` | finish the object now |
| `discrete` | 0/1 | `0` | no overlapping data flag |
| `quiet` | | `1` | suppress feedback |
| `zoom` | | `-1` | auto-zoom behaviour (-1 = use setting) |

## Behaviour
Forwards to `_cmd.load` with `loadable.xplorstr`, converting `state` from 1-based
to 0-based, with `multiplex` fixed at 0. Produces a map object that can then be
contoured with `isomesh`/`isosurface` or used as a `ramp_new` potential source.

## Examples
```
cmd.read_xplorstr(open('2fofc.xplor').read(), 'density')
```

## Related
- [read_pdbstr](../commands/read_pdbstr.md)
- [ramp_new](../commands/ramp_new.md)

## Source
`packages/engine/modules/pymol/importing.py:1074` (`def read_xplorstr`). Parity:
not registered as a command in `packages/engine-ts/src`.
