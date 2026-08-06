---
title: "End-to-end suite"
description: "21 specs against a real PyMOL bridge, a real vite dev server and a real headless Chromium. Nothing is mocked: structures load through cmd.load, the frames…"
---

# End-to-end suite

21 specs against a **real** PyMOL bridge, a **real** vite dev server and a real
headless Chromium. Nothing is mocked: structures load through `cmd.load`, the
frames come off PyMOL's own FBO, and the assertions read the DOM the user sees.

```bash
node apps/web/e2e/run.mjs                       # all 21
node apps/web/e2e/run.mjs -t "GL-free"          # substring match on the spec name
node apps/web/e2e/run.mjs --loud                # stream bridge + vite output
node apps/web/e2e/run.mjs 2>/dev/null           # results only; browser stderr is noisy
```

There is no `pnpm e2e` script — run `run.mjs` directly.

| File            | What                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `run.mjs`       | The runner: boots one stack, loops the specs, retries once, exits.                                                                |
| `harness.mjs`   | `startStack()` (bridge + vite + browser on free ports), `openApp()`, `findChrome()`, `freePort()`.                                |
| `smoke.e2e.mjs` | `export const tests = [...]` — the 21 specs, and the shared `run()` / `ask()` / `viewportStats()` helpers.                        |
| `files/`        | `ala.pdb`, `trp.pdb`. **Unreferenced** — no spec loads them; the structures the suite uses come from `packages/engine/test/dat/`. |

A spec is `{ name, async fn({ stack, assert, noGl }) }`. Add one to the array in
`smoke.e2e.mjs`; nothing else has to change.

## Exit codes are load-bearing

`0` everything passed. `1` a spec failed — **the product is broken**. `2` the
stack could not start — _this machine_ cannot run the suite (no
`packages/bridge/.venv`, no cached chromium). CI has to tell those apart, so do
not collapse them.

## Prerequisites

- `packages/bridge/.venv` with PyMOL built from this tree
  (`bash scripts/bootstrap.sh`).
- A cached `chrome-headless-shell` under `~/Library/Caches/ms-playwright`. The
  harness takes the **newest** build present rather than pinning one, because the
  cache holds several and they rotate; if there is none it exits 2 with
  `npx playwright install chromium-headless-shell`.
- `pnpm install` (vite is resolved from `apps/web/node_modules/.bin`, not the
  root — pnpm does not hoist it).

Note that `findChrome()` only looks for `chrome-headless-shell-mac-arm64`. This
suite runs on Apple Silicon as written.

## The gotchas, in the order they will bite you

**Every spec shares ONE PyMOL process.** Booting PyMOL costs seconds and the
specs each open their own page, so the runner boots a single stack. Session state
therefore carries across specs, in spec-array order. Assert on the object _you_
created, never on `all`: a spec asserting benzene had 12 atoms measured 11,390,
which was an earlier spec's 1tii plus the benzene. Scope the query
(`cmd.get_names("objects")[-1]`) or `reinitialize` first.

**`-t` filters, and filtering changes the state a spec inherits.** A spec that
only passes in a full run is order-dependent — that is a defect in the spec, not
in the filter, and running it alone is how you find out.

**Use `input.cmdline__input`, not `locator('input').first()`.** The loose
selector passed until the `files` and `menubar` panels landed inputs earlier in
the DOM, at which point the suite typed into a disabled search box and five of
six specs failed for reasons unrelated to what they tested.

**The bridge URL arrives via `VITE_TENMOL_WS_URL`.** The app has no `?bridge=`
query parameter (`apps/web/src/app/config.ts`), so the ephemeral port has to be
injected into vite's environment.

**The bridge's `Origin` allow-list is a fixed port range** (5173-5183 / 4173-4183,
`packages/bridge/tenmol_bridge/config.py`). The suite uses an ephemeral vite
port, so `startStack` passes `--origin` for it explicitly. Without that the
socket closes 1006 and every spec silently tests a disconnected app.

**vite is spawned directly, not through pnpm.** `pnpm --filter ... dev -- --port N`
does not forward the flag (observed: it served 5173 anyway), which would make two
concurrent runs collide.

**`--use-mock-keychain` and `--password-store=basic` are mandatory.** Without
them Chromium prompts for the macOS _login keychain password_ to encrypt its
cookie store, which interrupts whoever is at the keyboard. Do not remove them.

**The default page is 1280x900, and panels shrink.** Measured at that size with
six objects loaded, `.objpanel` is 36 px tall with a 128 px scrollHeight while
`.mvpanel` takes 221 — so an object row is reachable only through a 19 px scroll
window that any poll can reset. `openApp(stack, { viewport })` exists for specs
that are about row behaviour rather than about that squeeze.

**A `DisconnectedError` on first paint is tolerated.** The socket races the dev
server and the client is designed to reconnect. Any _other_ `pageerror` fails
the spec.

## Measuring "is it drawn" — three attempts, two of them wrong

Worth recording, because each looked right:

1. **`gl.readPixels`** — returns zeros. The canvas has no
   `preserveDrawingBuffer` (the correct default; preserving costs a full copy per
   frame), so reading outside the render loop sees nothing. It reported `ink=0`
   for a viewport that screenshots proved was drawing ubiquitin.
2. **PNG byte length of a canvas screenshot** — not monotonic in "how much is
   drawn". An empty canvas measured 44 kB, and `disable ubq` made the file
   _grow_.
3. **`?viewportHandle=1` → `window.__tenmolViewport.stats`** — what the suite
   uses. White-box, and the right trade: it is the seam the app exposes for
   exactly this, and it reports what actually reached the renderer.

`stats`, `cameraRpc` and `localPick` on that handle are what the viewport specs
assert on.

## The GL-free spec

One spec (`-t "GL-free"`) runs against a **second** bridge started `--no-gl`,
booted lazily by `noGl()` so an ordinary run pays nothing for it and torn down
with the main stack. Take your stack from `noGl()` rather than `stack` to opt in.

That bridge is what a Linux box without EGL or a Windows box without WGL looks
like, and the spec asserts the whole cross-platform claim in one place: the scene
renders client-side (`geometryTriangles > 1000`), a drag moves the camera by RPC,
a click selects an atom through the local pick index, and `healthz.draws` is
still **0** at the end.

**It must pass `?viewportPull=off`, and so must any spec asserting client-side
rendering.** With the dev PNG-pull source on, a `--no-gl` bridge still shows a
picture at about 1 fps, because `cmd.png(ray=0)` on a context-free PyMOL silently
ray-traces. The pull source then reports that it _is_ rasterising, the compositor
correctly defers to it, and Mode G draws nothing — which is indistinguishable
from a broken Mode G. The spec would measure the fallback instead of the thing
under test.

Also note that the Mode-G capability probe answers `no-accessor` on the very
first request, so the spec calls `setRepMode` in a short retry loop rather than
once.

## Flakiness, and what is done about it

Chromium's GPU process occasionally dies under repeated page creation with
swiftshader — the run logs `GPU process exited unexpectedly: exit_code=15` and a
spec that passes on its own fails. Each spec therefore gets **one retry**, and a
spec that only passed on the second attempt prints `(retried)`, so the flakiness
stays visible instead of being laundered into a green run.

An **assertion** failure is never retried; only infrastructure errors are, which
is what a GPU crash surfaces as. A real regression reproduces and still goes red.

## Why there is no test framework

Only `playwright-core` is a dependency — no browser download, no second runner.
The runner is ninety lines and an `assert()`. `@playwright/test` would pull a
second browser copy and a second reporter for no gain at this size.
