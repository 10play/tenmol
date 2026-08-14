---
name: load_png
kind: command
category: rendering-export
subcategory: image display
summary: Load and display a PNG image from disk in the PyMOL viewport, optionally as a movie frame.
parity: partial
---

## Purpose
`load_png` reads a PNG file from disk and shows it directly in the PyMOL display,
overlaying the 3D scene. It is used to review previously rendered images or to play
back a sequence of PNG frames as a movie.

## Syntax
`load_png(filename, movie=1, stereo=-1, quiet=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | — | path to the PNG file |
| `movie` | int | 1 | treat the image as a movie frame (1) or a single still (0) |
| `stereo` | int | -1 | stereo handling; -1 auto |
| `quiet` | int | 0 | suppress chatter (defaults to verbose) |

## Behaviour
The path is expanded via `exp_path`, then the image is handed to `_cmd.load_png`
under the API lock. If the displayed image is larger than the window it is halved
repeatedly until it fits. Unlike most loaders, `quiet` defaults to 0 (verbose). This
is a display/GUI operation, so it has no effect in a purely headless context.

## Examples
```text
load_png render_001.png
load_png still.png, movie=0
```

## Related
- [load_raw](load_raw.md) — load structured data from memory
- [loadall](loadall.md) — glob-load many files

## Source
`packages/engine/modules/pymol/viewing.py:1814` (`def load_png`). Registered as a
no-op stub in the TS port (`packages/engine-ts/src/cmd/extras.ts`) — display of PNGs
is outside the headless engine.
