---
name: ipython_image
kind: command
category: rendering-export
subcategory: notebook integration
summary: Renders the scene and returns it as an IPython.display.Image for inline notebook display.
parity: planned
---

## Purpose
`ipython_image` renders the current scene and returns it as an `IPython.display.Image`, so a figure appears inline in a Jupyter/IPython notebook. Use it when driving PyMOL from a notebook and you want the rendered frame as a cell output.

## Syntax
`ipython_image(*args, **kwargs)`

All positional and keyword arguments are forwarded verbatim to `cmd.png()` (filename excluded).

## Behaviour
Writes a PNG to a temporary file via `_self.png(filename, *args, **kwargs)`, wraps it in `IPython.display.Image`, and deletes the temp file afterward. Requires IPython to be importable. Because every argument passes through to `png`, options like `width`, `height`, `dpi`, and `ray` behave exactly as they do there.

## Examples
```python
from pymol import cmd
cmd.ipython_image(width=800, height=600, ray=1)
```

## Related
- [png](../commands/png.md)
- [ray](../commands/ray.md)

## Source
`packages/engine/modules/pymol/viewing.py:2218`. Parity: planned — notebook convenience wrapper, not ported in `packages/engine-ts/src`.
