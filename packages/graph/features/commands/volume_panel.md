---
name: volume_panel
kind: command
category: maps-volumes
subcategory: volume GUI
summary: Opens an interactive GUI panel for editing a volume object's color ramp; in Open-Source PyMOL it raises ImportError('pymol.Qt').
parity: implemented
---

## Purpose
`volume_panel` launches an interactive editor window for tuning a volume object's transfer function by hand — dragging color/alpha control points instead of scripting `volume_color`. It is a GUI convenience: in Open-Source / headless PyMOL the default (`_noqt=0`) path imports `pymol.Qt`, which that build does not ship, so the call raises `ImportError: pymol.Qt`.

## Syntax
`volume_panel(name, quiet=1, _noqt=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name of the volume object to edit |
| `quiet` | int | `1` | suppress feedback |
| `_noqt` | int | `0` | force the Tk fallback panel instead of Qt |

## Behaviour
It prefers a Qt panel (`pmg_qt.volume.VolumePanel`) when a Qt window exists and `_noqt` is falsy, reusing an already-open panel for the object or creating and showing one; otherwise it falls back to a Tk `Toplevel` titled `Volume Panel for "<name>"`. Panels are cached per object name so repeated calls raise the existing window rather than duplicating it. Requires an interactive GUI.

## Examples
```python
volume vol, map
volume_panel vol
```

## Related
- [volume](../commands/volume.md)
- [volume_color](../commands/volume_color.md)

## Source
`packages/engine/modules/pymol/colorramping.py:183`. Parity: `packages/engine-ts/src/cmd/extras.ts` raises `ImportError: pymol.Qt`, matching Open-Source PyMOL — verified against the real-PyMOL oracle (`packages/graph/verify/probes/command__volume_panel.json`). The browser's interactive volume panel is a separate UI surface (`apps/web/src/features/volume`), reached outside this cmd.
