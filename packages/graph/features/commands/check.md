---
name: check
kind: command
category: editing-building
subcategory: forcefield
summary: Unsupported stub that would assign forcefield parameters to a selection.
parity: implemented
---

## Purpose
`check` is an unsupported command that, in principle, would assign forcefield
parameters to a selection of atoms (a validation/typing step). It is not a
finished feature in open-source PyMOL.

## Syntax
`check(selection=None, preserve=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str/None | `None` | Atoms to check; when `None`, defaults to the first object. |
| `preserve` | int | `0` | Passed to the realtime typing setup. |

## Behaviour
When `selection` is `None` it falls back to the first object name from
`get_names("objects")`. The selection is processed and handed to
`chempy.tinker.realtime.assign(...)` / `.setup(...)` — code that is not part of
the standard PyMOL/ChemPy distribution, so the command generally does nothing
useful upstream. It exists mainly as a placeholder for forcefield assignment.

## Examples
```
check
check chain A
```

## Related
- [clean](../commands/clean.md)
- [sculpt_activate](../commands/sculpt_activate.md)

## Source
`packages/engine/modules/pymol/experimenting.py:73`. Upstream `check` does
`from chempy.tinker import realtime`, which imports the compiled `molobj` module
that is absent from Open-Source PyMOL, so `cmd.check` raises
`ModuleNotFoundError: No module named 'molobj'`. The TS port
(`packages/engine-ts/src/cmd/topics.ts`) reproduces that exact error to match the
oracle.
