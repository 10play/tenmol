---
name: read_sdfstr
kind: command
category: file-io
subcategory: in-memory load
summary: Load an MDL SD/MOL format structure from an in-memory Python string.
parity: implemented
---

## Purpose
`read_sdfstr` loads an MDL MOL/SD format structure from a Python string without a
temp file. Use it from API/bridge code to inject an SDF record directly.

## Syntax
`read_sdfstr(sdfstr, name, state=0, finish=1, discrete=1, quiet=1, zoom=-1, multiplex=-2, object_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sdfstr` | string | | the SD/MOL text |
| `name` | string | | object name to create/append into |
| `state` | integer | `0` | 1-based state index, or 0 to append |
| `finish` | 0/1 | `1` | finish the object now; 0 defers (call `finish_object`) |
| `discrete` | 0/1 | `1` | no overlapping atoms; saves memory but not editable |
| `quiet` | | `1` | suppress feedback |
| `zoom` | | `-1` | auto-zoom behaviour (-1 = use setting) |
| `multiplex` | | `-2` | split multi-record files into objects (-2 = use setting) |
| `object_props` | | `None` | object property spec |

## Behaviour
Forwards to `_cmd.load` with `loadable.sdf2str`, converting `state` from 1-based
to 0-based. `discrete=1` by default (compact, non-editable). `multiplex=-2`
follows the multiplex setting, so a multi-record SD file can split into separate
objects.

## Examples
```
cmd.read_sdfstr(sdf_record_text, 'compound')
```

## Related
- [read_molstr](../commands/read_molstr.md)
- [read_mmodstr](../commands/read_mmodstr.md)

## Source
`packages/engine/modules/pymol/importing.py:936` (`def read_sdfstr`). Parity:
implemented in `packages/engine-ts/src/cmd/fileio.ts:375`.
