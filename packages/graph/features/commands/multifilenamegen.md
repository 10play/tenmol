---
name: multifilenamegen
kind: command
category: file-io
subcategory: filename generation
summary: Internal helper that expands a filename pattern into per-object/state filenames and selections.
parity: internal
---

## Purpose
`multifilenamegen` is the internal generator behind [multifilesave](multifilesave.md).
Given a filename pattern with placeholders, an atom selection, and a state
argument, it yields `(filename, selection, state)` tuples - one per output file.

## Syntax
```
multifilenamegen(filename, selection, state)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | | pattern with placeholders (`{name}`, `{state}`, `{title}`, `{num}`, `{}`) |
| `selection` | str | | atom selection spanning objects/states |
| `state` | int | | state argument (-1 current, 0 all) |

## Behaviour
Parses the format keys in the pattern. Positional `{}` count as `nindexed`;
`{name}`/`{num}` imply multi-object output; `{state}`/`{title}` imply
multi-state. If neither is present it raises `ValueError` demanding at least one
of `{name}`, `{num}`, `{state}`, `{title}`. For each object in the selection it
builds an object-scoped sub-selection `(sel) & ?name`, expands the state range
(resolving `state<0` to the object's current state and `state==0` to all
states), zero-pads `{state}` and `{num}` to consistent widths, and formats the
final filename (positional args are object name then state). It looks up state
titles via `get_title` when multistate.

## Examples
```python
# internal; consumed by multifilesave
for fname, osele, ostate in multifilenamegen("/tmp/{name}-{state}.cif", "*", 0):
    ...
```

## Related
- [multifilesave](multifilesave.md) - the public command that drives this helper

## Source
`packages/engine/modules/pymol/exporting.py:735`. Not registered as a standalone
command in the TS port (helper folded into `multifilesave`).
