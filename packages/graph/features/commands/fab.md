---
name: fab
kind: command
category: editing-building
subcategory: molecular builder
summary: Builds a peptide object from a one-letter amino-acid sequence, optionally with a preset secondary structure.
parity: implemented
---

## Purpose
`fab` constructs a 3D peptide from a one-letter amino-acid code string. It is the quick way to spin up a model chain without loading a file, and it can lay the backbone down as a helix or sheet via the `ss` argument.

## Syntax
`fab(input, name=None, mode='peptide', resi=1, chain='', segi='', state=-1, dir=1, hydro=-1, ss=0, async_=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `input` | str | | sequence in one-letter code |
| `name` | str | `None` | name of object to create (default: unused name) |
| `mode` | str | `'peptide'` | build mode |
| `resi` | int | `1` | starting residue number |
| `chain` | str | `''` | chain identifier |
| `segi` | str | `''` | segment identifier |
| `state` | int | `-1` | target state |
| `dir` | int | `1` | build direction |
| `hydro` | int | `-1` | add hydrogens (-1 = follow `auto_show_lines`/H settings) |
| `ss` | int | `0` | secondary structure: 1=alpha helix, 2=antiparallel beta, 3=parallel beta, 4=flat |
| `async_` | int | `0` | build in a background thread when >=1 |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The peptide is assembled residue-by-residue from the fragment library. With `ss=0` the chain is built in an extended default geometry; setting `ss` to 1-4 imposes the corresponding backbone dihedral pattern. When `async_>=1` the build runs on a daemon thread and the command returns immediately. Passing an unknown keyword raises `CmdException`. `async` (without the trailing underscore) is accepted as an alias for `async_`.

## Examples
```python
fab ACDEFGH
fab ACDEFGH, helix, ss=1
fab GGGGG, mypep, chain=A
```

## Related
- [fnab](fnab.md) - nucleic-acid equivalent
- [fragment](fragment.md) - single fragment retrieval

## Source
`packages/engine/modules/pymol/editor.py` (`def fab`). Parity: implemented in `packages/engine-ts/src/cmd/editor.ts:569`.
