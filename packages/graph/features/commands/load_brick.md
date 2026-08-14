---
name: load_brick
kind: command
category: file-io
subcategory: import
summary: Load a volumetric "brick" object (temporary routine for the GAMESS-UK project).
parity: unknown
---

## Purpose
A special-purpose importer that loads an in-memory volumetric "brick" object. Documented upstream
as a temporary routine created for the GAMESS-UK project rather than a general-user command.

## Syntax
`load_brick(*arg, **kw)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `*arg` | — | — | positional arguments forwarded to `load_object` |
| `**kw` | — | — | keyword arguments forwarded to `load_object` |

## Behaviour
Prepends the `loadable.brick` type constant to the supplied arguments and delegates to
`load_object`. It takes no fixed named parameters of its own; everything is passed through. Being a
project-specific helper, it has no dedicated docstring beyond the "Temporary routine" note.

## Examples
```python
cmd.load_brick(brick_obj, "my_brick")
```

## Related
[load](load.md), load_object

## Source
`packages/engine/modules/pymol/importing.py:210`. Parity: not found in engine-ts; status unknown
(niche project-specific loader).
