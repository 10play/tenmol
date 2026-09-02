---
name: map_generate
kind: command
category: maps-volumes
subcategory: map synthesis
summary: Synthesizes an electron-density map object from reflection data (amplitudes and phases).
parity: implemented
---

## Purpose
`map_generate` computes a crystallographic map (e.g. 2Fo-Fc) by Fourier synthesis from a reflection file plus named amplitude, phase, and optional weight columns. Reach for it when you have MTZ reflection data and want a density map without a precomputed CCP4 file. Experimental — use with caution.

## Syntax
`map_generate(name, reflection_file, amplitudes, phases, weights='None', reso_low=50.0, reso_high=1.0, quiet=1, zoom=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the map object to create/modify |
| `reflection_file` | str | — | Path to a reflection file on disk (MTZ); if None, attempts PDB download |
| `amplitudes` | str | — | Fully qualified amplitudes column (`project/crystal/column`) |
| `phases` | str | — | Fully qualified phases column |
| `weights` | str | `'None'` | Fully qualified weights (FOM) column; `'None'` for unweighted |
| `reso_low` | float | `50.0` | Minimum resolution; if equal to `reso_high`, both are read from the file |
| `reso_high` | float | `1.0` | Maximum resolution; if equal to `reso_low`, both are read from the file |
| `quiet` | int | `1` | Suppress feedback when set |
| `zoom` | int | `1` | Zoom to the new map after creation |

## Behaviour
Reads the reflection file header via the `headering.MTZHeader` parser, resolves the dataset holding `amplitudes`, extracts unit-cell parameters and space group, and calls `_cmd.map_generate` to run the FFT into a temporary CCP4 file which is then `load`ed as the named map. Column names use the `crystal/dataset/column` convention; an empty dataset segment matches any dataset containing the column. Only MTZ input is supported (other formats "coming soon"). New in PyMOL v1.4 (Mac/Linux).

## Examples
```python
map_generate 2fofc, data.mtz, KINASE/crystal1/FWT, KINASE/crystal1/PHWT
map_generate fofc, data.mtz, /FDIFF, /PHDIFF, reso_low=30, reso_high=2.0
```

## Related
- [map_new](./map_new.md)
- [map_set](./map_set.md)
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/creating.py:176`. Parity: registered in `packages/engine-ts/src/cmd/maps.ts` as a blanket stub — engine-ts has no MTZ reflection reader, so it raises the same bare `CmdException` Open-Source PyMOL surfaces for an unreadable reflection file, for every call.
