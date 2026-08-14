---
name: exp_path
kind: command
category: control-flow-system
subcategory: path expansion
summary: Expands user (~) and environment-variable references in a filesystem path.
parity: unknown
---

## Purpose
`exp_path` normalizes a path string by expanding `~`/`~user` home references and `$VAR`/`%VAR%` environment variables, returning a concrete filesystem path. It is used internally wherever PyMOL accepts user-supplied file paths (load/save/etc.).

## Syntax
`exp_path(path)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `path` | str | — | Path possibly containing `~` and environment variables |

## Behaviour
The path is first coerced to a proper path string (`as_pathstr`, which on Windows decodes byte strings to unicode via utf-8/mbcs), then passed through `os.path.expanduser` and an internal `expandvars`. The result is a plain expanded string; it does not check existence or resolve symlinks.

## Examples
```python
cmd.exp_path("~/structures/1ubq.pdb")
cmd.exp_path("$PYMOL_DATA/pymol/matrices/BLOSUM62")
```

## Related
- [load](../commands/load.md)
- [save](../commands/save.md)
- [cd](../commands/cd.md)

## Source
`packages/engine/modules/pymol/cmd.py:112`. Parity: path-expansion helper; not surfaced as a discrete verb in the TypeScript engine slice.
