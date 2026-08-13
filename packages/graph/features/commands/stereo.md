---
name: stereo
kind: command
category: viewing-camera
subcategory: stereo display
summary: Activates or deactivates stereo 3D display mode.
parity: implemented
---

## Purpose
`stereo` turns stereoscopic 3D viewing on or off and selects the stereo method.
Use it to drive hardware quad-buffer stereo, cross-/wall-eye free viewing, or
side-by-side displays such as GeoWall and OpenVR.

## Syntax
`stereo(toggle='on', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `toggle` | string | `'on'` | One of `on`, `off`, `crosseye`, `walleye`, `quadbuffer`, `sidebyside`, `geowall`, `openvr`. |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
The `toggle` argument is validated against the stereo dictionary
(`stereo_dict` / `stereo_sc.auto_err`), so abbreviations and invalid modes raise.
`quadbuffer` is the default when hardware stereo is available; otherwise `crosseye`
is the default enabled mode. `stereo on` selects the platform default; explicit
modes force a specific technique.

## Examples
```
stereo on
stereo crosseye
stereo off
```

## Related
- [set](../commands/set.md)

## Source
`packages/engine/modules/pymol/viewing.py:1266`. Parity: implemented — the TS
engine records the stereo flag as a setting in
`packages/engine-ts/src/cmd/extras.ts:477`.
