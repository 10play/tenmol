---
name: get_collada
kind: command
category: rendering-export
subcategory: 3D scene export
summary: Returns a COLLADA (.dae) string representing the currently displayed scene.
parity: implemented
---

## Purpose
`get_collada` returns a COLLADA 1.4.1 XML string capturing the geometry currently displayed, suitable for import into external 3D tools (Blender, etc.). Reach for it to export the scene as tessellated mesh geometry rather than a raster image.

## Syntax
`get_collada(version=2)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | int | `2` | COLLADA output version selector |

## Behaviour
Renders via SceneRay mode 8 into COLLADA XML. Spheres are tessellated per-primitive using `sphere_quality` triangle strips; cylinders, sausages, and cones are tessellated with a `DAE_MAX_EDGE` of 50. `cPrimCharacter` and `cPrimEllipsoid` primitives are dropped (empty `break;`). Each primitive becomes one `<geometry><mesh>`, with node splitting at a 1,000,000-element limit. Behaviour is influenced by `collada_geometry_mode` (0 = valid COLLADA, 1 = Blender polylist), `collada_export_lighting`, `collada_background_box`, and `geometry_export_mode`. Requires `_HAVE_LIBXML` in the native build, else it errors. Also reachable via `cmd.save('x.dae')`.

## Examples
```python
dae = cmd.get_collada()
open("scene.dae", "w").write(cmd.get_collada())
```

## Related
- [png](../commands/png.md)
- [ray](../commands/ray.md)
- [save](../commands/save.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:648`; native writer `packages/engine/layer1/COLLADA.cpp:676`. Parity: implemented — tracked done in `docs/feature-parity.md` (COLLADA .dae export).
