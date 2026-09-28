# tenmol motion reel

A 24-second motion-graphics reel for tenmol, rendered from code at 1080p60. The render writes two
files: [`docs/showreel/tenmol-reel.mp4`](../../docs/showreel/tenmol-reel.mp4), a 720p30 MP4 with
sound, and `tenmol-reel.webp`, a silent animated preview that plays inline in the README.

Every frame is a pure function of time, so the render is deterministic and frames can be drawn in
parallel. Picture and sound read the same timeline (`lib.mjs`) at 120 BPM, which keeps cuts,
keystrokes and atom landings in sync with the beat.

| Act | Time | What happens |
|---|---|---|
| 01 ATOM | 0–2 s | A line collapses into a nucleus, and electron orbits spin up into the first hit |
| 02 MOLECULE | 2–6 s | Caffeine assembles one atom per sixteenth note, with kinetic type |
| 03 PROTEIN | 6–12 s | All 5,469 atoms of **1TII** (from `packages/engine/test/dat`) burst into a galaxy and implode into the structure. The backbone then draws itself, the camera settles down the 5-fold axis for HUD callouts, and flies through the pore |
| 04 COMMAND | 12–16 s | Real PyMOL commands (`load`, `show cartoon`, `spectrum count, rainbow`, `set ray_trace_mode, 1`) each change the model on the beat |
| 05 STACK | 16–20 s | Fast-cut words for the architecture, then the package pipeline |
| 06 TENMOL | 20–24 s | Particles form the wordmark, followed by the logo mark, tagline and URL |

- `scenes.mjs` draws everything in Canvas 2D: depth-sorted shaded tubes, lit sphere sprites and
  additive particles.
- `post.mjs` is a WebGL finishing pass that adds two-level bloom, chromatic aberration, vignette,
  grain and impact flashes.
- `audio.mjs` synthesizes the soundtrack from scratch: kick, clap, hats, bass, pads, plucks,
  risers, booms and typing clicks.

## Render

```sh
# Needs a Chromium for playwright-core and an ffmpeg (e.g. `npm i ffmpeg-static`).
CHROME=/path/to/chrome FFMPEG=/path/to/ffmpeg node tools/showreel/render.mjs            # full reel
CHROME=... node tools/showreel/render.mjs --stills 150,640,900 --dir /tmp/stills          # review frames
CHROME=... node tools/showreel/render.mjs --serve                                        # live preview (?play&t=12)
```

Rendering takes about 6 minutes with `--workers 3`. Each worker is a separate headless Chromium
running SwiftShader.
