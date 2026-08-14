---
name: loadall
kind: command
category: file-io
subcategory: glob loader
summary: Load every file matching a filesystem glob pattern, optionally grouping the resulting objects.
parity: partial
---

## Purpose
`loadall` expands a shell-style glob pattern and loads every matching file with a
single command, optionally collecting the created objects into a group. It is the
quick way to pull a whole directory of structures into a session.

## Syntax
`loadall(pattern, group='', quiet=1, **kwargs)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pattern` | str | — | glob pattern (expanded via `exp_path`) |
| `group` | str | `''` | if set, group the loaded objects under this name |
| `quiet` | int | 1 | print each filename as it loads when 0 |
| `**kwargs` | — | — | extra arguments forwarded to each `load` call |

## Behaviour
`glob.glob` is run on the expanded pattern and each match is passed to `load` with
the supplied `kwargs`. When `group` is given, the objects are grouped afterwards:
member names come from `filename_to_objectname`, unless an explicit `object=` kwarg
was passed — in which case a warning is printed (all files would load into one
object) and that single name is grouped. Any `load` keyword (e.g. `state`,
`discrete`) can be forwarded through `kwargs`.

## Examples
```text
loadall *.pdb
loadall data/*.cif, group=structures
```

## Related
- [load_traj](load_traj.md) — trajectory frames
- [load_embedded](load_embedded.md) — inline script data

## Source
`packages/engine/modules/pymol/importing.py:1513` (`def loadall`). Bridge path marked
done in `docs/feature-parity.md`; registered as a no-op stub in the TS port
(`packages/engine-ts/src/cmd/extras.ts`, no filesystem glob available).
