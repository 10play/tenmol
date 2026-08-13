---
name: load_traj
kind: command
category: movies-scenes-states
subcategory: trajectory import
summary: Read a molecular-dynamics trajectory file and append its frames as states of an existing object.
parity: partial
---

## Purpose
`load_traj` loads a trajectory file (Amber, DCD, XTC, TRR, DTR and other VMD
molfile-plugin formats) and appends each frame as a new state on an already-loaded
molecular object. Use it after loading the corresponding topology/structure to
animate an MD run.

## Syntax
`load_traj(filename, object='', state=1, format='', interval=1, average=1, start=1, stop=-1, max=-1, selection='all', image=1, shift='[0.0,0.0,0.0]', plugin='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | — | path to the trajectory file |
| `object` | str | `''` | target object; guessed from filename or last object if blank |
| `state` | int | 1 | first state to populate, or 0 to append after the last state |
| `format` | str | `''` | file format; guessed from extension if blank |
| `interval` | int | 1 | take every Nth frame |
| `average` | int | 1 | frame averaging (trj only, possibly broken) |
| `start` | int | 1 | first frame to read from the file |
| `stop` | int | -1 | last frame to read, or -1 for all |
| `max` | int | -1 | max number of states to load, or 0 for all |
| `selection` | str | `'all'` | load coordinates only for this subset |
| `image` | 0/1 | 1 | residue-based periodic image transformation (trj only) |
| `shift` | float-3 | `[0,0,0]` | offset for the image transformation |
| `plugin` | str | `''` | VMD plugin name; guessed from magic/format if blank |

## Behaviour
You must load a topology/structure object first — the trajectory frames are appended
to it. Gzipped trajectories are rejected. For `trj` format the flavour is
autodetected from a magic string; otherwise a VMD molfile plugin is resolved. When
`object` is blank the target is guessed from the filename or falls back to the last
object (`obj01` as a last resort). `average` is not a running average — use `smooth`
for that. `shift` is parsed with `safe_list_eval` (the docstring flags this as
dangerous). The import dialog also sets `defer_builds_mode, 3` before calling this.

## Examples
```text
load top.prmtop, mysystem
load_traj md.dcd, mysystem
load_traj md.xtc, mysystem, start=100, stop=500, interval=5
```

## Related
- [load_coordset](load_coordset.md) — append a single coordinate frame
- [loadall](loadall.md) — glob-load many files
- `load` — load the topology/structure first

## Source
`packages/engine/modules/pymol/importing.py:341` (`def load_traj`). Bridge/C++ path
marked done in `docs/feature-parity.md`; registered as a no-op stub in the TS port
(`packages/engine-ts/src/cmd/extras.ts`).
