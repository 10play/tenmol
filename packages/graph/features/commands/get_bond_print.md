---
name: get_bond_print
kind: command
category: internal
subcategory: debugging
summary: Experimental/debug helper that dumps internal bond-print information for an object.
parity: unknown
---

## Purpose
`get_bond_print` is an experimental, undocumented debugging helper that returns internal bond-print data for an object up to a maximum bond count and type. It is not part of the everyday API and carries no DESCRIPTION docstring upstream.

## Syntax
`get_bond_print(obj, max_bond, max_type)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `obj` | str | — | Object name |
| `max_bond` | int | — | Maximum bond count to report |
| `max_type` | int | — | Maximum bond type to report |

## Behaviour
Acquires the interpreter lock and dispatches directly to `_cmd.get_bond_print(obj, max_bond, max_type)`, returning whatever the C layer produces. It lives in the `experimenting` module alongside other debug utilities (`spheroid`, `mem`) and follows the legacy explicit `lock`/`unlock` error-raising pattern rather than the modern `lockcm` context manager. Not intended for scripting.

## Examples
```python
cmd.get_bond_print("myobj", 10, 5)
```

## Related
- [get_bonds](../commands/get_bonds.md)

## Source
Upstream `packages/engine/modules/pymol/experimenting.py:25`. Parity: unknown — no equivalent found in `packages/engine-ts/src`; internal/experimental debug helper.
