---
name: get_povray
kind: command
category: rendering-export
subcategory: povray export
summary: Return the (header, geometry) POV-Ray scene-description strings for the current scene.
parity: implemented
---

## Purpose
`get_povray` renders the current scene into a POV-Ray input description and
returns it as a tuple of strings. Reach for it to hand PyMOL geometry to the
POV-Ray ray tracer for high-quality external rendering.

## Syntax
`get_povray()`

This command takes no arguments.

## Behaviour
Locks the API and calls the C-layer POV-Ray writer (SceneRay mode 1), returning a
`(header, geometry)` tuple of POV-SDL strings. The geometry string emits analytic
POV primitives plus `smooth_color_triangle` meshes, with fog, gamma, spec_power
and shininess baked in. `cmd.save('x.pov')` uses this same path; in immediate mode
PyMOL can shell out to `PPovrayRender` and reload the resulting PNG.

## Examples
```python
header, geometry = cmd.get_povray()
open("scene.pov", "w").write(header + geometry)
```

## Related
- [get_session](get_session.md), [ray](ray.md), [save](save.md)

## Source
`packages/engine/modules/pymol/querying.py:547`; writer
`packages/engine/layer1/Ray.cpp:2517`. Parity: implemented — tracked done in
`docs/feature-parity.md:151`.
