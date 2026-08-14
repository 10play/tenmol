---
name: get_renderer
kind: command
category: rendering-export
subcategory: opengl introspection
summary: Return (and optionally print) the OpenGL vendor / renderer / version strings.
parity: unknown
---

## Purpose
`get_renderer` reports the OpenGL implementation strings (vendor, renderer,
version) for the current graphics context. Use it to detect the GPU/driver and
diagnose rendering issues.

## Syntax
`get_renderer(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | If `0`, prints `GL_VENDOR`, `GL_RENDERER`, `GL_VERSION` to the console |

## Behaviour
Locks the API and reads the three OpenGL strings from the C layer, returning them
as a tuple `(vendor, renderer, version)`. When `quiet=0` it prints a labelled
"OpenGL graphics engine" block. In a headless context the values reflect whatever
GL context (if any) is available.

## Examples
```python
vendor, renderer, version = cmd.get_renderer()
cmd.get_renderer(quiet=0)
```

## Related
- [get_version](get_version.md)

## Source
`packages/engine/modules/pymol/querying.py:863`. Parity: unknown — not registered
in `packages/engine-ts/src`; referenced only as a proposed `/health` endpoint in
`docs/feature-parity.md:512`.
