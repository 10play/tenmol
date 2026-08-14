---
name: select
kind: command
category: selecting
subcategory: named selections
summary: Creates a named atom selection from a selection-expression.
parity: implemented
---

## Purpose
`select` evaluates a selection-expression and stores the matching atoms under a reusable name, which then behaves like any other selection or object reference. It is the primary way to name and revisit sets of atoms for coloring, showing, measuring, or editing.

## Syntax
`select(name, selection='', enable=-1, quiet=1, merge=0, state=0, domain='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | a unique name for the selection |
| `selection` | str | `''` | the selection-expression to evaluate |
| `enable` | int | `-1` | show the selection indicator; `-1` = default, `1` = on, `0` = off |
| `quiet` | int | `1` | suppress console feedback |
| `merge` | int | `0` | merge with the existing selection of this name instead of replacing |
| `state` | int | `0` | object state for state-dependent operators (`0` = ignore) |
| `domain` | str | `''` | restrict the evaluation to atoms within this selection |

## Behaviour
If the first argument is a selection-expression wrapped in explicit parentheses (e.g. `select (resn HIS)`), it is taken as the `selection` and the default name `sele` is used. `merge=1` unions the new atoms into any pre-existing selection of the same name. `domain` limits where the expression is evaluated, and `state` supplies the frame for state-sensitive operators such as proximity. Named selections created here can be deleted with `delete`.

## Examples
```python
select chA, chain A
select ( resn HIS )
select near142, resi 142 around 5
```

## Related
- [select_list](select_list.md) — API-only selection by atom index
- [delete](delete.md) — remove a named selection

## Source
Upstream: `packages/engine/modules/pymol/selecting.py:49`. Parity: implemented as a core builtin at `packages/engine-ts/src/engine.ts:454` (`ex.select(name, selection)`); the TS builtin currently honours `name`/`selection`, with the extra `enable`/`merge`/`state`/`domain` refinements not yet wired.
