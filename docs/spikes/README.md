---
title: "Spikes — the measurement record"
description: "A spike is the record of an experiment: we did not know X, we measured it, here is the number. These eight files are the only place several of those numbers…"
---

# Spikes — the measurement record

A spike is the record of an **experiment**: we did not know X, we measured it, here is the number.
These eight files are the only place several of those numbers exist, and they are why the code is
shaped the way it is — `scripts/doctor.mjs` copies its GL probe verbatim from
`04-picking.md` §2 and says so in a comment, and `scripts/bootstrap.sh` and
`packages/bridge/tenmol_bridge/glcontext/egl.py` both cite a spike by section number in comments
beside the code the spike explains.

**Do not read a spike as a description of the code today.** Read it as "this is what was true when
this was measured, and this is how to re-measure it". Each file now opens with a
`STATUS` block naming what has moved since.

Counts as of 2026-08-02: `scripts/bootstrap.sh` cites `00-build.md` in **6** comments,
`glcontext/egl.py` cites `07-cross-platform-gl.md` in **5**.

## The one answer people come here for

> **Does offscreen GL work on Linux with no GPU, no X server and no `/dev/dri`?**
> **YES — measured three times on real Linux, most recently 2026-08-02.** EGL surfaceless on
> Mesa/llvmpipe gives a desktop **OpenGL 4.5 compatibility** context; PyMOL renders a 5,684-atom
> cartoon with `glGetError() == 0` and picks an atom on 3 of 3 clicks.
> `07-cross-platform-gl.md` §2.8, reproduced independently in §2.9,
> and re-run post-monorepo in §2.10 with every value identical.
> Re-run it yourself with `bash scripts/test-gl-linux.sh --quick --out /tmp/gl` (~1 min, needs
> Docker; pass `--out` because the default dirties the tree).
>
> **Windows (`wgl.py`) has never executed.** Do not describe it as working. §4.2 and §6.4.

## Index

| Spike | Question it answered | Still load-bearing? |
| --- | --- | --- |
| `00-build.md` | Does PyMOL build and import from this tree, headless, on macOS arm64? | **Yes.** `scripts/bootstrap.sh` is this recipe. §6.1 is **amended** (see its STATUS block). |
| `02-feedback.md` | Can the PyMOL console be captured with no Qt and no GL? | **Yes, unchanged.** Both rules are implemented verbatim in `packages/bridge/tenmol_bridge/engine.py`. |
| `03-geometry.md` | Is new C++ needed to get renderable geometry out? | **Yes** — and everything it measured about the *exporters* stands. Its §0/§9 "no server raster" conclusion is **overturned**; see its STATUS block. |
| `04-picking.md` | Can a headless backend pick? | **Yes, with a GL context.** §2/§3 is the CGL recipe `glcontext/cgl.py` and `scripts/doctor.mjs` both carry. |
| `05-state-events.md` | Is polling fast enough to be the change feed? | **Yes** (0.25 % of a core at 30 Hz) — but its §8 C++ wish-list was **superseded** by spike 08, which built something different on purpose. |
| `06-geometry-accessor.md` | What does `_cmd.web_get_rep_geometry` return? | **Yes** — §7 (the API) and §5 (the fidelity numbers) are the contract `packages/bridge/tenmol_bridge/render/modeg.py` consumes. §0 counts and §10 gaps have moved. |
| `07-cross-platform-gl.md` | Linux EGL? Windows WGL? | **Linux: verified. Windows: unverified.** See the box above. |
| `08-native-changes.md` | Exact invalidation, and pick data without a GL pick pass. | **Yes** — but `packages/engine/layer4/CmdWebGeometry.cpp` has grown since; see its STATUS block. |

There is no `01-` and no spike after `08`. Nothing outside this paragraph references a spike 01
(`grep -rn "spikes/01" docs/` matches only this line), so the gap is a numbering gap, not a
lost file.

## The rule that matters if you edit these

Section numbers are **cited from source code**, not just from prose. Renumbering a section
silently breaks a comment in a shipped module. The live citations, verified by grep on
2026-08-02:

| Cited section | Cited from |
| --- | --- |
| `00-build.md` §1, §2.1, §2.2, §3, §3.1, §4.3 | `scripts/bootstrap.sh` (six separate comments) |
| `00-build.md` §3 | `scripts/dev-bridge.sh` |
| `00-build.md` §5.2 | `scripts/doctor.mjs` |
| `00-build.md` §6.2 | `packages/bridge/tenmol_bridge/dispatch.py`, `policy/base.py`, `packages/bridge/README.md` |
| `00-build.md` (the venv) | `packages/bridge/tenmol_bridge/feedback.py` |
| `03-geometry.md` §8 | `packages/protocol/README.md`, `packages/protocol/src/geometry.ts` |
| `04-picking.md` §2 (**verbatim**), §2/§3 (**verbatim**) | `scripts/doctor.mjs:160`, `packages/bridge/tenmol_bridge/glcontext/cgl.py:3` |
| `04-picking.md` (whole) | `packages/bridge/tenmol_bridge/glcontext/__init__.py` |
| `06-geometry-accessor.md` (whole) | `packages/bridge/tenmol_bridge/render/modeg.py` |
| `07-cross-platform-gl.md` §"Provenance" | `packages/bridge/tenmol_bridge/glcontext/egl.py:55` |
| `07-cross-platform-gl.md` §2.7 *(written as `§3.4` — see below)*, §6.4 *(written as `§4`)* | `glcontext/egl.py:264,965`, `glcontext/wgl.py:86` |
| `07-cross-platform-gl.md` (whole) | `.github/workflows/webclient-gl-linux.yml` |

**Three of those citations point at the wrong section**, in files this directory does not own:
`egl.py:264` and `egl.py:965` both say `§3.4` (which is ANGLE) when they mean **§2.7** D-EGL-1 and
D-EGL-3, and `wgl.py:86` says "the manual Windows acceptance procedure is §4" when it is **§6.4**.
Rather than renumber the spike to match the mistake, a redirect note now sits at the top of §3.4
and §4 so a reader who follows either citation lands somewhere useful.

## Re-running anything in here

Every spike was run against a session scratchpad venv that no longer exists. The interpreter that
exists today, built by `bash scripts/bootstrap.sh`, is:

```
packages/bridge/.venv/bin/python          # PyMOL 3.2.0a Open-Source, built from packages/engine/
```

Substitute it for every `<scratch>/venv/bin/python` and
`/private/tmp/claude-501/…/scratchpad/venv/bin/python` in these files. The probe scripts
themselves (`e1_click.py`, `probe_reps.py`, `t1_counters.py`, …) were deliberately throwaway and
are **gone**; each spike's "Reproducing" section describes what they did well enough to rewrite.
