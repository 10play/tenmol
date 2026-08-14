---
name: selection_sc
kind: command
category: internal
subcategory: autocompletion
summary: Internal helper that builds a Shortcut over object names and selection keywords for tab-completion.
parity: internal
---

## Purpose
`selection_sc` is not a user command but an internal completion helper. It returns a `Shortcut` object populated with the current public object/selection names plus the selection-language keywords (`not `, `and `, `or `, `byres `, `bychain `, ...). PyMOL's argument-autocompletion machinery consults it to offer completions wherever a selection argument is expected.

## Syntax
`selection_sc(sc=<Shortcut>, gn=<get_names>)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sc` | class | `pymol.shortcut.Shortcut` | the Shortcut constructor to build with |
| `gn` | callable | `get_names` | function returning public object/selection names |

## Behaviour
Implemented as a lambda that concatenates `get_names('public')` with a fixed list of selection operators and prefixes, then wraps them in a `Shortcut` for prefix matching. It is referenced by the completion tables (e.g. `aa_sel_e`, `aa_sel_c` in `completing.py`), not invoked directly by scripts. Because it exposes live object names, its result changes as objects are created or deleted.

## Related
- [select](select.md) — the command whose argument this completes

## Source
Upstream: defined as a lambda in `packages/engine/modules/pymol/cmd.py:347`; consumed by `packages/engine/modules/pymol/completing.py:56`. Parity: internal autocompletion plumbing, not exposed as a TS command.
