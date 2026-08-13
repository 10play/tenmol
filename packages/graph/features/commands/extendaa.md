---
name: extendaa
kind: command
category: control-flow-system
subcategory: command registration
summary: API-only decorator that registers a Python function as a PyMOL command with argument auto-completion.
parity: internal
---

## Purpose
`extendaa` ("extend + auto-arg") is a decorator used in scripts/plugins to expose a Python function as a typed PyMOL command whose arguments get tab-completion. It is API-only — there is no command-line form.

## Syntax
`extendaa(*arg)` used as a decorator, where each positional `arg` is an auto-arg spec (or `None`) for the corresponding function parameter.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `*arg` | auto_arg specs | — | One completion spec per parameter; `None` skips that positional |

## Behaviour
Returns a wrapper that (1) calls `cmd.extend(func.__name__, func)` to register the function as a command, and (2) fills `cmd.auto_arg[i][name]` from each provided spec so argument `i` gets the given completer. Specs are typically drawn from existing entries like `cmd.auto_arg[0]['zoom']`. Passing `None` at a position leaves that argument without completion.

## Examples
```python
@cmd.extendaa(cmd.auto_arg[0]['zoom'])
def zoom_organic(selection='*'):
    cmd.zoom('organic & (%s)' % selection)
```

## Related
- [extend](../commands/extend.md)
- [alias](../commands/alias.md)

## Source
`packages/engine/modules/pymol/commanding.py:834` (API-only). Parity: registration decorator; not applicable to the TypeScript engine slice.
