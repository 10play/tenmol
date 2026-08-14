---
name: api
kind: command
category: control-flow-system
subcategory: introspection
summary: Prints the fully-qualified module.function name that implements a given PyMOL command.
parity: implemented
---

## Purpose
`api` is an API-helper that resolves a command name to the concrete Python function (module + function) that implements it, and prints the source file. Use it when scripting or debugging to discover which `cmd.*`/module function a keyword maps to.

## Syntax
`api(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of a PyMOL command |

## Behaviour
It resolves `name` through `kwhash.auto_err` (so abbreviations/typos raise a helpful error), looks up `cmd.keyword[name][0]`, then prints three lines: ` CMD:` the resolved command name, ` API:` the `module.function` (and `cmd.<name>` if the function is bound on the `cmd` object), and ` FILE:` the module's source file. It returns the function object itself. The docstring also documents the general API convention: always use `cmd`, never `_cmd`, and note the API is thread-safe.

## Examples
```python
api color
# CMD: color
# API: pymol.coloring.color
# API: cmd.color
# FILE: .../pymol/coloring.py
```

## Related
- [Shortcut](./Shortcut.md)

## Source
`packages/engine/modules/pymol/helping.py:277`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts`.
