---
name: get_chains
kind: command
category: querying
subcategory: identifier query
summary: Returns the list of chain identifiers present in a selection.
parity: implemented
---

## Purpose
`get_chains` returns the distinct chain identifiers found in a selection. Reach for it to iterate over chains or drive per-chain coloring/selection logic (it underpins helpers like `cbc`/`color_chains`).

## Syntax
`get_chains(selection='(all)', state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atom selection |
| `state` | int | `0` | **Currently ignored** |
| `quiet` | 0/1 | `1` | If `0`, prints ` cmd.get_chains: <list>` |

## Behaviour
The selection is processed and wrapped in parentheses, then passed to `_cmd.get_chains`. The `state` argument is accepted but **currently ignored**. Returns a list of chain-id strings; if the C layer returns `None`, an empty list `[]` is returned instead. With `quiet=0` the list is printed.

## Examples
```python
get_chains
chains = cmd.get_chains("polymer")
for ch in cmd.get_chains("myprotein"):
    cmd.color("cyan", f"chain {ch}")
```

## Related
- [get_names](../commands/get_names.md)
- [count_atoms](../commands/count_atoms.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:1128`. Parity: implemented — registered as `ctx.command('get_chains')` in `packages/engine-ts/src/cmd/analysis.ts:217`.
