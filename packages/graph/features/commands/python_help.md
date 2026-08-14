---
name: python_help
kind: command
category: control-flow-system
subcategory: help
summary: Help stub explaining how Python keywords and blocks work inside the PyMOL command language.
parity: unknown
---

## Purpose
`python_help` is the help topic that fires when you ask PyMOL for help on a
Python keyword. It is documentation-only: it points at the official Python docs
and explains how to embed Python inside PyMOL command scripts.

## Syntax
| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `string` | | | the Python keyword the help was requested for |

## Behaviour
Prints guidance rather than doing anything computational. Key points from the
docstring: multi-line Python blocks in `.pml` command files require explicit
line-continuation (`\`) to execute correctly; for anything non-trivial you should
put the code in a `.py` file and expose it via `extend`, which gives better error
checking. Consult https://www.python.org for keyword semantics.

## Examples
```
a=1
while a<10: \
    print(a) \
    a=a+1
```

## Related
- [extend](../commands/extend.md)
- [run](../commands/run.md)

## Source
`packages/engine/modules/pymol/helping.py` (`def python_help`). Parity: not
registered as a command in `packages/engine-ts/src` (help-only topic).
