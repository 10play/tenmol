---
name: alignto
kind: command
category: fitting-alignment
subcategory: batch superposition
summary: Aligns every other loaded object onto one target object using a chosen algorithm.
parity: implemented
---

## Purpose
`alignto` superposes all other loaded objects onto a single target using the specified alignment algorithm. It is a convenience wrapper around `extra_fit`, ideal for lining up a whole set of homologous structures against one reference in a single call.

## Syntax
`alignto(target='', method='cealign', selection='', quiet=1, **kwargs)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | str | `''` | Reference object name (default: first object in selection) |
| `method` | str | `'cealign'` | Alignment method — see `extra_fit` |
| `selection` | str | `''` | Objects to move (default: all public objects) |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
When `selection` is empty it queries `get_names("public_objects")` and builds a selection of all public objects (prefixing each with `%`), raising `CmdException('no public objects')` if none exist. It then delegates to `extra_fit(selection, target, method, 0, quiet, **kwargs)`, so any extra keyword arguments (e.g. `object=`) flow through to `extra_fit`. The default `method='cealign'` makes it robust for low sequence identity.

## Examples
```python
fetch 1cll 1sra 1ggz 1k95, async=0
alignto 1cll, method=cealign
alignto 1cll, object=all_to_1cll
```

## Related
- [extra_fit](../commands/extra_fit.md)
- [align](./align.md)
- [super](../commands/super.md)
- [cealign](../commands/cealign.md)

## Source
`packages/engine/modules/pymol/fitting.py:265`. Parity: implemented in `packages/engine-ts/src/cmd/align.ts`.
