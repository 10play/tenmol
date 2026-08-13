---
name: spawn
kind: command
category: control-flow-system
subcategory: scripting
summary: Launches a Python script in a new background thread that runs concurrently with the interpreter.
parity: implemented
---

## Purpose
`spawn` runs a Python script asynchronously in its own thread so it executes alongside interactive PyMOL rather than blocking the prompt. Use it for long-running or background tasks; use `run` for the synchronous equivalent.

## Syntax
`spawn(filename, namespace='module')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | — | Path to the Python script to launch |
| `namespace` | string | `'module'` | Namespace to execute in: module, local, or global |

## Behaviour
`spawn` is a thin wrapper over `run(filename, namespace, 1, ...)`, where the `1` requests threaded (spawned) execution. The default `module` namespace runs the script like an imported module with its own globals; `local`/`global` run it in the calling local or the global namespace. The docstring recommends the `-l` startup option for spawning processes at launch time. Because it runs concurrently, the script shares the interpreter and must respect PyMOL's threading/locking model.

## Examples
```python
spawn my_background_task.py
spawn analysis.py, global
```

## Related
- [run](./run.md)
- [cd](./cd.md)

## Source
`packages/engine/modules/pymol/parsing.py` (`def spawn`); signature in `docs/api-reference/commands.mdx:3859`. Parity: implemented in `packages/engine-ts/src/cmd/controlflow.ts`.
