---
name: multifilesave
kind: command
category: file-io
subcategory: batch export
summary: Saves each object and/or state of a multi-object selection to a separate file.
parity: implemented
---

## Purpose
`multifilesave` writes a selection that spans multiple objects and/or states out
as many files, one per object/state, using a filename template with
placeholders. Reach for it to bulk-export an ensemble or a multi-object scene
without saving each piece by hand.

## Syntax
```
multifilesave(filename, selection='*', state=-1, format='', ref='', ref_state=-1, quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | | output path template with placeholders |
| `selection` | str | `'*'` | selection spanning objects/states |
| `state` | int | `-1` | object state (-1=current, 0=all) |
| `format` | str | `''` | file format (default: guess from extension) |
| `ref` | str | `''` | object defining the reference frame |
| `ref_state` | int | `-1` | state of the `ref` object |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The filename supports placeholders: `{name}` (object name), `{state}` (state
number), `{title}` (state title), `{num}` (file number), and positional `{}`
(object name first, state second). It expands the template via
[multifilenamegen](multifilenamegen.md), then calls `save` for each generated
`(filename, selection, state)` triple with the given `format`/`ref`/`ref_state`.
At least one object- or state-varying placeholder is required.

## Examples
```
multifilesave /tmp/{name}.pdb
multifilesave /tmp/{name}-{state}.cif, state=0
multifilesave /tmp/{}-{title}.sdf, state=0
```

## Related
- [multisave](multisave.md) - multi-entry single file
- [multifilenamegen](multifilenamegen.md) - filename expansion helper
- `save` - single-file export

## Source
`packages/engine/modules/pymol/exporting.py:707`. Registered in the TS port at
`packages/engine-ts/src/cmd/exporters.ts:560`.
