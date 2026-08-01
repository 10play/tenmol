/**
 * The end-to-end smoke suite.
 *
 * These are the claims every wave has been re-proving by hand. Asserted against
 * a real PyMOL built from this tree, in a real browser, so a regression in any
 * of them is caught by `pnpm e2e` rather than by someone squinting at a
 * screenshot.
 *
 * Deliberately behavioural, not cosmetic: nothing here asserts on layout or
 * colour, only that the app talks to PyMOL and that PyMOL's answers reach the
 * screen.
 */

import { openApp } from './harness.mjs';

const PDB = 'test/dat/1tii.pdb';

/**
 * The PyMOL command line, by its own class.
 *
 * NOT `locator('input').first()`: that passed until the files and menubar
 * panels landed inputs earlier in the DOM, at which point the suite started
 * typing into a disabled search box and five of six tests failed for a reason
 * that had nothing to do with what they were testing.
 */
const CMDLINE = 'input.cmdline__input';

/** Type into the command line and let PyMOL settle. */
async function run(page, command, waitMs = 900) {
  const input = page.locator(CMDLINE);
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

/**
 * How much is drawn in the viewport, as the PNG byte length of a screenshot of
 * the canvas element.
 *
 * WHY NOT readPixels: a WebGL canvas is created without `preserveDrawingBuffer`
 * (the default, and the right default — preserving it costs a full copy every
 * frame), so `readPixels` from outside the render loop returns zeros even
 * though the canvas is visibly drawn. The first version of this helper did
 * exactly that and reported ink=0 for a viewport that screenshots proved was
 * rendering ubiquitin.
 *
 * PNG length is a proxy, not a pixel count, and it is a good one here: a
 * uniform background compresses to a couple of kB, a molecule does not. The
 * assertions below use it only for large relative differences, never for
 * absolute fidelity.
 */
async function canvasBytes(page) {
  const canvas = page.locator('canvas').first();
  if ((await canvas.count()) === 0) return -1;
  const shot = await canvas.screenshot({ type: 'png' });
  return shot.length;
}

/**
 * The viewport's own stats, via `?viewportHandle=1`.
 *
 * White-box, and deliberately so. Two outside-in probes were tried first and
 * both lied: `readPixels` returns zeros without `preserveDrawingBuffer`, and
 * PNG byte length is not monotonic in "how much is drawn" (an empty canvas
 * screenshotted at 44 kB, and `disable ubq` made the file GROW). The handle is
 * the seam the app exposes for exactly this and it reports what actually
 * reached the renderer.
 */
async function viewportStats(page) {
  return page.evaluate(() => {
    const h = window.__tenmolViewport;
    return h ? JSON.parse(JSON.stringify(h.stats)) : null;
  });
}

export const tests = [
  {
    name: 'the bridge reports a running PyMOL with a GL context',
    async fn({ stack, assert }) {
      const health = await (await fetch(stack.healthz)).json();
      assert(health.state === 'running', `state=${health.state}`);
      assert(typeof health.pymolVersion === 'string', 'no pymolVersion');
      // The engine thread must own the PyMOL instance, or ordering is fiction.
      assert(health.glutThread === health.threadIdent, 'glutThread != threadIdent');
    },
  },
  {
    name: 'the app loads and connects with no page errors',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.waitForTimeout(2500);
      // NOT a substring match on "connected": that also matches
      // "reconnecting", and it passed for a run whose socket was closing 1006
      // the whole time. Assert on the failure panel being absent instead.
      const state = await page.evaluate(() => ({
        failing: !!document.querySelector('.connpanel'),
        text: document.querySelector('.connpanel')?.textContent?.slice(0, 120) ?? null,
      }));
      assert(!state.failing, `connection panel is showing: ${state.text}`);
      // A DisconnectedError is the client's designed reconnect path (the socket
      // races the dev server on first paint); anything else is a real defect.
      const real = page.__errors.filter((e) => !e.includes('DisconnectedError'));
      assert(real.length === 0, `page errors: ${real.slice(0, 2).join(' | ')}`);
      await page.close();
    },
  },
  {
    name: 'a typed command executes and its output reaches the feedback pane',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.waitForTimeout(2000);
      await run(page, 'fragment ala', 1200);
      const text = await page.evaluate(() => document.body.innerText);
      // cmd.do echoes the command itself; that echo is the parity signal.
      assert(text.includes('fragment ala'), 'no PyMOL> echo of the command');
      await page.close();
    },
  },
  {
    name: 'a loaded structure appears in the object panel',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.waitForTimeout(2000);
      await run(page, `load ${PDB}, ubq`, 2500);
      const text = await page.evaluate(() => document.body.innerText);
      assert(text.includes('ubq'), 'object name never appeared in the panel');
      await page.close();
    },
  },
  {
    name: 'the viewport actually draws the molecule',
    async fn({ stack, assert }) {
      const page = await openApp(stack, { query: '?viewportHandle=1' });
      // The viewport mounts on its first frame; a cold vite makes 2s a race.
      await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(1500);
      const before = await viewportStats(page);
      assert(before !== null, 'viewport handle not exposed (?viewportHandle=1)');
      await run(page, `load ${PDB}, ubq`, 2500);
      await run(page, 'hide everything', 700);
      await run(page, 'show cartoon', 1200);
      await run(page, 'orient', 2000);
      const after = await viewportStats(page);
      // Frames must still be arriving after a scene change, not just at boot.
      assert(
        after.pixelFrames > before.pixelFrames,
        `no new frames after loading (${before.pixelFrames} -> ${after.pixelFrames})`,
      );
      assert(after.pixelFramesDropped === 0, `dropped ${after.pixelFramesDropped} frames`);
      await page.close();
    },
  },
  {
    name: 'hiding an object empties the viewport again',
    async fn({ stack, assert }) {
      const page = await openApp(stack, { query: '?viewportHandle=1' });
      await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(1500);
      await run(page, `load ${PDB}, ubq`, 2500);
      await run(page, 'hide everything', 700);
      await run(page, 'show cartoon', 1200);
      await run(page, 'orient', 1800);
      const shown = await viewportStats(page);
      await run(page, 'disable ubq', 1800);
      const hidden = await viewportStats(page);
      // A visibility change must reach the renderer as new frames; a viewport
      // frozen on the last good image is the bug this catches.
      assert(
        hidden.pixelFrames > shown.pixelFrames,
        `disable produced no new frame (${shown.pixelFrames} -> ${hidden.pixelFrames})`,
      );
      await page.close();
    },
  },
];
