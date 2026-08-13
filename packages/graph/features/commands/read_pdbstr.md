---
name: read_pdbstr
kind: command
category: file-io
subcategory: in-memory load
summary: Load or update a structure from a PDB-format Python string, no temp file.
parity: unknown
---

## Purpose
`read_pdbstr` is an API-only loader that reads a PDB file from a Python string.
Use it to load or update structures into PyMOL without writing any temporary
files — the primary way bridge/scripting code injects PDB content.

## Syntax
`read_pdbstr(contents, oname, state=0, finish=1, discrete=0, quiet=1, zoom=-1, multiplex=-2, object_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `contents` | string | | the PDB text |
| `oname` | string | | object name to create/update |
| `state` | integer | `0` | 1-based state index, or 0 to append |
| `finish` | 0/1 | `1` | finish the object now; 0 defers (call `finish_object`) |
| `discrete` | 0/1 | `0` | no overlapping atoms; saves memory but not editable |
| `quiet` | | `1` | suppress feedback |
| `zoom` | | `-1` | auto-zoom behaviour (-1 = use setting) |
| `multiplex` | | `-2` | split multi-MODEL files into objects (-2 = use setting) |
| `object_props` | | `None` | object property spec |

## Behaviour
Forwards to `_cmd.load` with `loadable.pdbstr`, converting `state` from 1-based to
0-based. Unlike the MOL loaders, `discrete` defaults to 0 (atoms may overlap and
the object stays editable) and `multiplex=-2` follows the multiplex setting so
multi-MODEL content can split into separate objects. `finish=0` defers processing
for bulk loads and requires a later `finish_object`. This is the handler the
loadfunctions registry uses for the `pdb` format.

## Examples
```
cmd.read_pdbstr(open('1ubq.pdb').read(), 'ubq')
```

## Related
- [read_molstr](../commands/read_molstr.md)
- [read_xplorstr](../commands/read_xplorstr.md)

## Source
`packages/engine/modules/pymol/importing.py:1008` (`def read_pdbstr`). Parity:
not registered as a command in `packages/engine-ts/src`; referenced by the
loadfunctions registry (docs/feature-parity.md, "loadfunctions registry").
