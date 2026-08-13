---
name: load
kind: command
category: file-io
subcategory: import
summary: Read molecules, maps, sessions, and other content from a file path or URL into PyMOL.
parity: implemented
---

## Purpose
The universal import command. `load` reads molecular structures, crystallographic/volumetric maps,
PyMOL sessions, trajectories, and more, choosing a parser from the file extension (or an explicit
`format`).

## Syntax
`load(filename, object='', state=0, format='', finish=1, discrete=-1, quiet=1, multiplex=None, zoom=-1, partial=0, mimic=1, object_props=None, atom_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | — | file path or URL |
| `object` | string | `''` | target object name (default: filename prefix) |
| `state` | int | `0` | state to load into; `0` appends after the last existing state |
| `format` | string | `''` | explicit format (pdb, ccp4, …); default from file extension |
| `finish` | int | `1` | finish/geometry-update after load |
| `discrete` | int | `-1` | force discrete states (`-1` = auto) |
| `quiet` | int | `1` | suppress feedback |
| `multiplex` | int | `None` | split multi-model files into separate objects (None → -2 auto) |
| `zoom` | int | `-1` | zoom after load (`-1` = use setting) |
| `partial` | int | `0` | partial load |
| `mimic` | int | `1` | mimic original file conventions |
| `object_props` | str | `None` | object-level properties to import |
| `atom_props` | str | `None` | atom-level properties to import |

## Behaviour
The extension determines the format unless `format` is given explicitly; `plugin:<name>` selects a
molfile plugin, and the legacy `pkl` maps to the `model` format. A `format` that is one of the
`*str` in-memory types is deprecated and redirected to `load_raw` with a warning. If `object` is
empty the file prefix is used (or `get_unused_name('obj')`); for trajectory formats (`dcd`, `dtr`)
the most-recently-added structure is used as the trajectory target. `filename` is unquoted and
expanded via `exp_path`. Supported formats include pdb/mol/mol2/sdf/xyz (molecules) and
xplor/ccp4/phi (maps), among others.

## Examples
```python
load 1dn2.pdb
load file001.pdb, ligand
load http://delsci.com/sample.pdb
```

## Related
[save](save.md), load_traj, [fetch](fetch.md)

## Source
`packages/engine/modules/pymol/importing.py:643`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/fileio.ts:428`).
