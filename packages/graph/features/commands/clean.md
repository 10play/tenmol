---
name: clean
kind: command
category: sculpting-minimization
subcategory: energy minimization
summary: MMFF94 energy-minimization 'clean up' of a selection — incentive-only; raises IncentiveOnlyException (matched by the TS engine).
parity: implemented
---

## Purpose
`clean` runs a short energy minimization over a selection using an MMFF94 force
field, tidying up bond lengths, angles, and clashes after building or editing a
molecule. It is the "clean" button of the molecular editor.

## Syntax
`clean(selection, present='', state=-1, fix='', restrain='', method='mmff', async_=0, save_undo=1, message=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | Atoms to minimize. |
| `present` | str | `''` | Atoms held present (context) during minimization. |
| `state` | int | `-1` | State to operate on. |
| `fix` | str | `''` | Atoms held fixed. |
| `restrain` | str | `''` | Atoms under positional restraint. |
| `method` | str | `'mmff'` | Force field method. |
| `async_` | int | `0` | Run asynchronously when set. |
| `save_undo` | int | `1` | Push an undo checkpoint. |
| `message` | str/None | `None` | Progress message. |

## Behaviour
In open-source PyMOL this command raises `IncentiveOnlyException` — the MMFF94
"clean" minimizer ships only in the commercial Incentive build. Conceptually it
minimizes `selection` while keeping `fix` atoms immobile and `restrain` atoms
tethered, using surrounding `present` atoms for context.

## Examples
```
clean ligand
clean resi 50-60, fix=(not resi 50-60)
```

## Related
- [sculpt_activate](../commands/sculpt_activate.md)
- [check](../commands/check.md)

## Source
`packages/engine/modules/pymol/computing.py:20` (raises
`IncentiveOnlyException` — MMFF94 `clean` ships only in Incentive PyMOL). The TS
port matches upstream by raising the identical incentive-only error
(`packages/engine-ts/src/cmd/sculpt.ts`, `ctx.command('clean', …)`), verified
against the real-PyMOL oracle; the builder panel already reports the same reason
(`clean_available = false`).
