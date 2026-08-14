---
name: get_cifstr
kind: command
category: file-io
subcategory: in-memory export
summary: Returns a mmCIF string for a selection (API-only).
parity: implemented
---

## Purpose
`get_cifstr` is an API-only convenience wrapper that serializes a selection to an mmCIF string in memory. Reach for it to obtain CIF text without writing a file — the CIF analogue of `get_pdbstr`.

## Syntax
`get_cifstr(selection='all', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atom selection |
| `state` | int | `-1` | Object state; `-1` = current |
| `quiet` | 0/1 | `1` | Verbosity |

## Behaviour
Thin wrapper over `get_str('cif', selection, state, '', -1, -1, quiet)` — i.e. it delegates to the same export machinery as [get_bytes](../commands/get_bytes.md) with the format fixed to `cif` and no reference frame. Returns a `str` (text), not bytes.

## Examples
```python
cif = cmd.get_cifstr("polymer")
open("out.cif", "w").write(cmd.get_cifstr("myobj"))
```

## Related
- [get_pdbstr](../commands/get_pdbstr.md)
- [get_bytes](../commands/get_bytes.md)
- [save](../commands/save.md)

## Source
Upstream `packages/engine/modules/pymol/exporting.py:937`. Parity: implemented — registered as `ctx.command('get_cifstr')` in `packages/engine-ts/src/cmd/exporters.ts:490`.
