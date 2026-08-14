---
name: ls
kind: command
category: control-flow-system
subcategory: filesystem
summary: Lists the contents of the current working directory (optionally filtered by a glob pattern).
parity: implemented
---

## Purpose
`ls` prints the contents of the working directory, like the shell `ls`/`dir` command. Reach for it when you need to see what files are available before a `load`, `run`, or `save`. Also aliased as `dir`.

## Syntax
`ls(pattern=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pattern` | str | `None` | Optional path or glob; `None` lists everything (`*`) |

## Behaviour
If `pattern` is `None` it defaults to `*`. Otherwise the pattern is expanded via `exp_path` (resolves `~` and environment vars). If the pattern contains no `*`, it first tries listing the directory contents (`glob(pattern/*)`); failing that it globs the pattern directly. Matches are sorted and printed one per line. When nothing matches it prints `ls: Nothing found. Is that a valid path?`.

## Examples
```python
ls
ls *.pml
ls ~/structures
```

## Related
- [cd](../commands/cd.md)
- [pwd](../commands/pwd.md)
- [system](../commands/system.md)

## Source
`packages/engine/modules/pymol/externing.py:73`. Parity: implemented as a virtual OS shim (returns `[]`, never touches the real filesystem) in `packages/engine-ts/src/cmd/system.ts:123`.
