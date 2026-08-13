---
name: pwd
kind: command
category: control-flow-system
subcategory: filesystem
summary: Print the current working directory to the log.
parity: implemented
---

## Purpose
`pwd` prints PyMOL's current working directory. Reach for it when a relative
`load`/`save`/`run` path is behaving unexpectedly, or after a `cd` to confirm
where PyMOL will resolve filenames.

## Syntax
```
pwd
```
Takes no arguments.

## Behaviour
Prints the process working directory (via `os.getcwd`) and returns success. This
is the same directory PyMOL uses to resolve relative paths for file I/O. Use
`cd` to change it and `ls` to list its contents.

## Examples
```
pwd
```

## Related
- [cd](../commands/cd.md)
- [ls](../commands/ls.md)
- [system](../commands/system.md)

## Source
`packages/engine/modules/pymol/externing.py:56` (`def pwd`). Parity: the
TypeScript port registers `pwd` in `packages/engine-ts/src/cmd/system.ts:121`
(returns `'/'` in the sandboxed engine).
