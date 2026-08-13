---
name: load_mtz
kind: command
category: maps-volumes
subcategory: reflection import
summary: Load an MTZ reflection file as map object(s); raises IncentiveOnlyException in this (open-source) build.
parity: partial
---

## Purpose
`load_mtz` reads crystallographic structure factors from an MTZ file and turns them
into electron-density map objects — either an fofc/2fofc pair, or a single map when
amplitude and phase columns are named explicitly. It is the reflection-file entry
point behind the MTZ import dialog.

## Syntax
`load_mtz(filename, prefix='', amplitudes='', phases='', weights='None', reso_low=0, reso_high=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | — | path to the MTZ file |
| `prefix` | str | `''` | object name or prefix (default: filename without extension) |
| `amplitudes` | str | `''` | amplitudes column name; guessed if blank |
| `phases` | str | `''` | phases column name; required if amplitudes are given |
| `weights` | str | `'None'` | weights column name (optional) |
| `reso_low` | float | 0 | minimum resolution; 0 reads from file |
| `reso_high` | float | 0 | maximum resolution; 0 reads from file |
| `quiet` | int | 1 | suppress chatter |

## Behaviour
When amplitude and phase columns are supplied, a single map object is produced;
otherwise PyMOL derives the standard fofc and 2fofc maps. **In this build the
function immediately raises `IncentiveOnlyException`** — it is a licensed
(incentive) feature and is not implemented in the open-source engine. The MTZ import
dialog still parses headers (via `pymol.headering.MTZHeader`) and builds the call,
but execution fails at `load_mtz` itself.

## Examples
```text
load_mtz refine.mtz, prefix=map
load_mtz refine.mtz, map, amplitudes=2FOFCWT, phases=PH2FOFCWT
```

## Related
- [load_map](load_map.md) — load a ChemPy map object
- [load_object](load_object.md) — generic loader

## Source
`packages/engine/modules/pymol/importing.py:1481` (`def load_mtz`, raises
`IncentiveOnlyException`). Called by the MTZ dialog; noted broken-in-this-build in
`docs/feature-parity.md`. Registered as a no-op stub in
`packages/engine-ts/src/cmd/extras.ts`.
