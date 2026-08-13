---
name: loadable
kind: command
category: internal
subcategory: type-code namespace
summary: Namespace class mapping human-readable format names to the numeric type codes used by load_object.
parity: internal
---

## Purpose
`loadable` is not an action command but a constants namespace (a class) that maps
format names to the integer type codes the C loader understands. The `load_*`
wrappers reference it (`loadable.cgo`, `loadable.model`, `loadable.map`) to tell
[load_object](load_object.md) how to interpret their payload.

## Syntax
Accessed as attributes, e.g. `cmd.loadable.pdb`, `cmd.loadable.cgo`. It also exposes
`loadable._reverse_lookup(number)` to recover a name from a code.

## Behaviour
Selected codes (from `_loadable`): `pdb=0`, `mol=1`, `molstr=3`, `xplor=7`,
`model=8`, `pdbstr=9`, `brick=10`, `chempymap=11`, `callback=12`, `cgo=13`,
`xyz=15`, `ccp4=18`, `trj=22`, `sdf=37`, `cif=60`, `mae=65`, `mmtf=71`, `map=73`,
`mrc=74`, `bcif=78`. `sdf` and `sdf2` both equal 37. `loadable` subclasses
`_loadable` and adds `_reverse_lookup`, which scans the class attributes for a
matching value and returns the first name (or `''`). These codes feed the
`_load2str` map that pairs file type codes with their string-buffer equivalents.

## Examples
```python
cmd.load_object(cmd.loadable.cgo, my_cgo, "geom")
cmd.loadable._reverse_lookup(0)   # -> 'pdb'
```

## Related
- [load_object](load_object.md) — consumes these type codes
- [load_raw](load_raw.md) — resolves its `format` argument against this namespace

## Source
`packages/engine/modules/pymol/constants.py:9` (`class _loadable`) and `:65`
(`class loadable`). Internal constants; not ported as a command in
`packages/engine-ts/src`.
