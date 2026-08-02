# End-to-end suite (WP-27)

```bash
node apps/web/e2e/run.mjs              # all specs
node apps/web/e2e/run.mjs -t viewport  # substring filter
node apps/web/e2e/run.mjs --loud       # stream bridge + vite output
```

Boots a real PyMOL bridge and a real vite dev server on **free ports**, drives
the app in headless Chromium, tears everything down. Nothing is mocked: the
structures load through `cmd.load`, the frames come off PyMOL's own FBO.

Exit codes are distinct on purpose: `0` all passed, `1` a test failed (the
product is broken), `2` the stack could not start (this machine cannot run the
suite — no `packages/bridge/.venv`, no cached chromium). CI needs to tell those apart.

## Why it looks like this

**No `@playwright/test`.** Only `playwright-core` is a dependency — no browser
download, no second runner. At six specs the runner is thirty lines and a
`assert()`; a test framework would cost more than it returns.

**Chromium is resolved, not pinned.** `~/Library/Caches/ms-playwright` holds
several builds and they rotate. The harness takes the newest present and fails
with the install command if there is none.

**`--use-mock-keychain` and `--password-store=basic` are mandatory.** Without
them Chromium asks for the macOS *login keychain password* to encrypt its cookie
store, which interrupts whoever is at the keyboard. Do not remove them.

**The bridge URL arrives via `VITE_TENMOL_WS_URL`.** The app has no `?bridge=`
query parameter (`apps/web/src/app/config.ts:39`), so a random port has to be
injected into vite's environment.

## Measuring "is it drawn" — three attempts, two wrong

Worth recording, because each looked right:

1. **`gl.readPixels`** — returns zeros. The canvas has no
   `preserveDrawingBuffer` (the correct default; preserving costs a full copy
   per frame), so reading outside the render loop sees nothing. Reported `ink=0`
   for a viewport that screenshots proved was drawing ubiquitin.
2. **PNG byte length of a canvas screenshot** — not monotonic in "how much is
   drawn". An empty canvas measured 44 kB, and `disable ubq` made the file
   *grow*.
3. **`?viewportHandle=1` → `window.__tenmolViewport.stats`** — what the suite
   uses. White-box, and the right trade: it is the seam the app exposes for
   this, and it reports what actually reached the renderer.

Selectors are specific for the same reason: `locator('input').first()` passed
until the `files` and `menubar` panels landed inputs earlier in the DOM, at
which point the suite typed into a disabled search box and five of six specs
failed for reasons unrelated to what they tested. Use `input.cmdline__input`.

## GL-free specs

One spec runs against a SECOND bridge started `--no-gl`, booted lazily so an
ordinary run pays nothing for it. That is what a Linux box without EGL or a
Windows box without WGL looks like, and the spec asserts the whole
cross-platform claim in one place: the scene renders client-side, a drag moves
the camera by RPC, a click selects an atom through the local pick index, and
`healthz.draws` is still 0 at the end.

Take a spec's stack from `noGl()` rather than `stack` to opt in.

## The PNG-pull fallback hides Mode G

`?viewportPull=off` matters more than it looks. With the dev PNG-pull source
ON, a bridge started `--no-gl` STILL shows a picture at about 1 fps, because
`cmd.png(ray=0)` on a context-free PyMOL silently ray-traces. The pull source
then reports that it IS rasterising, the compositor correctly defers, and Mode
G shows `0 draws` — which is indistinguishable from a broken Mode G.

Any spec asserting client-side rendering must pass `viewportPull=off`, or it
will measure the fallback instead of the thing under test.

## Shared backend state

All specs run against ONE PyMOL process, so session state carries between them.
Assert on the object you created, not on `all` — a spec asserting benzene was 12
atoms got 11390, which was an earlier spec's 1tii plus the benzene. Either scope
the query (`cmd.get_names("objects")[-1]`) or `reinitialize` first.

## Flakiness, and what is done about it

Chromium's GPU process occasionally dies under repeated page creation with
swiftshader — the run logs `GPU process exited unexpectedly: exit_code=15` and a
spec that passes on its own fails. Each spec therefore gets **one retry**, and a
spec that only passed on the second attempt is printed `(retried)` so the
flakiness stays visible instead of being laundered into a green run.

An **assertion** failure is never retried. Only infrastructure errors are, which
is how a GPU crash surfaces. A real regression reproduces and still goes red.

Browser stderr is noisy (`[vite] connecting`, DevTools banners, the GPU warning).
Pipe it away with `2>/dev/null` when you only want the results.

A `DisconnectedError` on first paint is tolerated — the socket races the dev
server and the client is designed to reconnect. Any other page error fails.
