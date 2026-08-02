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

/*
 * The callbacks passed to `page.evaluate()` are serialised and run in the
 * BROWSER, so they legitimately reference `window` and `document` even though
 * this file executes under node. Declared here rather than in the shared
 * eslint.config.js, which WP-00 owns.
 */
/* global window, document, HTMLElement */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { REPO, openApp } from './harness.mjs';

const PDB = 'packages/engine/test/dat/1tii.pdb';

/**
 * The PyMOL command line, by its own class.
 *
 * NOT `locator('input').first()`: that passed until the files and menubar
 * panels landed inputs earlier in the DOM, at which point the suite started
 * typing into a disabled search box and five of six tests failed for a reason
 * that had nothing to do with what they were testing.
 */
const CMDLINE = 'input.cmdline__input';

/**
 * Type into the command line and let PyMOL settle.
 *
 * Waits for the input rather than trusting a fixed delay after `goto`. The
 * fixed-delay version passed in isolation and failed intermittently in the full
 * suite, where seven pages load in sequence against one dev server.
 */
async function run(page, command, waitMs = 900) {
  const input = page.locator(CMDLINE);
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

/** Evaluate a python expression and read the answer out of the console. */
async function ask(page, expr) {
  await run(page, `print("Q=", ${expr})`, 1100);
  const text = await page.evaluate(() => document.body.innerText);
  const all = [...text.matchAll(/Q= *([^\n]*)/g)];
  return all.length ? all[all.length - 1][1].trim() : '?';
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
  {
    /**
     * The integration check a 13-slot wave needs and that no single slot owner
     * can write: every feature that shipped a directory must actually MOUNT.
     *
     * Three states are distinguishable in the DOM, which is what makes this
     * assertable rather than a guess:
     *   .feature-failed  — the panel threw and the error boundary caught it
     *   .feature-absent  — no directory; the registry renders its "not built" note
     *   anything else    — mounted
     *
     * A slot with a directory but no working `register.ts` shows up as ABSENT,
     * silently looking like unbuilt work rather than a wiring mistake. That is
     * the failure this catches.
     */
    name: 'every shipped feature slot mounts without throwing (overlays via the launcher)',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.waitForTimeout(3500);

      const dom = await page.evaluate(() => ({
        failed: Array.from(document.querySelectorAll('.feature-failed')).map((el) => ({
          title: el.querySelector('.feature-failed__title')?.textContent ?? '?',
          message: el.querySelector('.feature-failed__message')?.textContent ?? '',
        })),
        absentOwners: Array.from(document.querySelectorAll('.feature-absent__owner')).map(
          (el) => el.textContent ?? '',
        ),
      }));

      assert(
        dom.failed.length === 0,
        `slots threw: ${dom.failed.map((f) => `${f.title}: ${f.message}`).join(' | ')}`,
      );

      // A directory on disk is a promise that the slot is installed.
      const featuresDir = join(REPO, 'apps/web/src/features');
      const shipped = readdirSync(featuresDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(featuresDir, d.name, 'register.ts')))
        .map((d) => d.name);
      assert(shipped.length > 0, 'no feature directories found at all');

      // Overlay panels are CLOSED until opened — they used to render
      // unconditionally, and ten of them stacked in the document flow pushed the
      // viewport off screen. So open every one from the launcher first;
      // "shipped implies mounted" only holds once they are open. This also means
      // the launcher itself is covered.
      const launchers = page.locator('.overlay-launcher__btn');
      const n = await launchers.count();
      for (let i = 0; i < n; i++) await launchers.nth(i).click();
      await page.waitForTimeout(800);

      // `document.body.dataset.features` — a side channel, so the check cannot
      // perturb layout. An earlier wrapper element with `display: contents` had
      // no box and made Playwright click at (0,0).
      const mounted = await page.evaluate(() =>
        (document.body.dataset.features ?? '').split(' ').filter(Boolean),
      );
      // Hard failure, not a skip. An earlier version gated this on
      // `mounted.length > 0`, which made the whole check vacuous the moment the
      // `data-feature` tag was missing — it reported green while proving
      // nothing. If the tag disappears, this must go red.
      assert(
        mounted.length > 0,
        `no slot carries data-feature; the mount check proves nothing ` +
          `(${shipped.length} shipped on disk)`,
      );
      const missing = shipped.filter((id) => !mounted.includes(id));
      assert(missing.length === 0, `shipped but not mounted: ${missing.join(', ')}`);
      await page.close();
    },
  },
  {
    /**
     * The menu bar is DATA, not markup: `packages/engine/modules/pymol/menu.py` generates most
     * of it at runtime and every leaf is a command string executed with
     * `cmd.do` (`packages/engine/layer4/PopUp.cpp:471-475`). So the thing worth asserting is
     * not that buttons exist but that a leaf reaches PyMOL and that check state
     * comes from settings rather than local React state.
     */
    name: 'a checkable menu leaf executes and reflects live setting state',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      const input = page.locator(CMDLINE);
      await input.waitFor({ state: 'visible', timeout: 20_000 });

      const tops = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.menubar button'))
          .map((b) => b.textContent?.trim())
          .filter(Boolean),
      );
      assert(
        ['File', 'Edit', 'Build', 'Movie', 'Display', 'Setting'].every((m) => tops.includes(m)),
        `menu bar is missing entries: ${JSON.stringify(tops)}`,
      );

      const read = async () => {
        await run(page, 'print("IP=", cmd.get("internal_prompt"))', 1100);
        const text = await page.evaluate(() => document.body.innerText);
        const all = [...text.matchAll(/IP= *(\S+)/g)];
        return all.length ? all[all.length - 1][1] : '?';
      };
      const before = await read();

      await page.getByRole('button', { name: 'Display', exact: true }).click();
      await page.waitForTimeout(400);
      await page.getByText('Internal Prompt', { exact: false }).first().click();
      await page.waitForTimeout(1000);

      const after = await read();
      assert(after !== before, `menu leaf did not reach PyMOL (internal_prompt stayed ${before})`);
      await page.close();
    },
  },
  {
    /**
     * The advanced settings table is the one surface that proves settings
     * introspection works end to end: enumerate ~779 settings from the backend,
     * filter them, and write one back.
     */
    name: 'the advanced settings table filters and writes through to PyMOL',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.waitForTimeout(800);
      await page.getByText('Edit All', { exact: false }).first().click();
      await page.waitForTimeout(1500);

      await page
        .locator('.setadv__filter input, input[placeholder="regex or substring"]')
        .first()
        .fill('sphere_scale');
      await page.waitForTimeout(1200);

      const before = await ask(page, "cmd.get('sphere_scale')");
      const value = page.locator('.setadv__c-value input').first();
      assert((await value.count()) === 1, 'filter did not narrow to one editable row');
      await value.fill('0.75');
      await value.press('Enter');
      await page.waitForTimeout(1500);
      const after = await ask(page, "cmd.get('sphere_scale')");

      assert(after !== before, `setting did not write through (stayed ${before})`);
      assert(after.startsWith('0.75'), `expected 0.75, got ${after}`);
      await page.close();
    },
  },
  {
    /**
     * The browser cannot open a native file dialog, so File > Open is a
     * BRIDGE-SERVED path browser over the real filesystem. This pins the whole
     * round trip: navigate, list, select, and land an object in PyMOL.
     */
    name: 'File > Open loads a structure through the bridge-served path picker',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });
      const before = await ask(page, 'cmd.get_names("objects")');

      await page.getByRole('button', { name: 'File dialogs', exact: true }).click();
      await page.waitForTimeout(700);
      await page.locator('.files__strip button').first().click();
      await page.waitForTimeout(700);
      await page.getByText(/^Open…/).first().click();
      await page.waitForTimeout(1200);

      // Directory rows descend on a SINGLE click (`PathPicker.tsx:267`) and are
      // rendered with a `▸` prefix, so match on that — an exact-text match on
      // the bare name matches nothing, and a double click fires two navigations.
      // `packages/engine/` first: the upstream PyMOL tree, and therefore its `test/dat`
      // fixtures, moved under it when the repo was reorganised.
      for (const dir of ['packages', 'engine', 'test', 'dat']) {
        await page
          .locator('.fpick__row--dir')
          .filter({ hasText: new RegExp(`^▸${dir}$`) })
          .first()
          .click();
        await page.waitForTimeout(1200);
      }

      const crumbs = await page.evaluate(() =>
        [...document.querySelectorAll('.fpick__crumb')].map((c) => c.textContent?.trim()),
      );
      assert(crumbs.includes('dat'), `picker did not navigate: ${crumbs.join('/')}`);

      const file = page.locator('.fdlg').getByText('1tii.pdb', { exact: true }).last();
      assert((await file.count()) > 0, '1tii.pdb not listed in packages/engine/test/dat');
      await file.click();
      await page.waitForTimeout(500);
      await page
        .locator('.fdlg')
        .getByRole('button', { name: /^(Open|OK|Load)/ })
        .first()
        .click();
      await page.waitForTimeout(2500);

      const after = await ask(page, 'cmd.get_names("objects")');
      assert(after.includes('1tii'), `object never loaded (before=${before} after=${after})`);
      await page.close();
    },
  },
  {
    /**
     * Wizards are rendered by ONE generic component driven by the wizard
     * protocol (`get_panel` / `get_prompt`), not by twelve bespoke React
     * panels. The way to prove that is to drive two unrelated wizards through
     * the same renderer and then execute a panel button.
     */
    name: 'the generic wizard renderer drives real wizards and its buttons execute',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });
      await run(page, 'load packages/engine/test/dat/1tii.pdb, ubq', 2400);

      await run(page, 'wizard measurement', 1800);
      const measure = await page.evaluate(
        () => document.querySelector('[class*="wiz"]')?.textContent ?? '',
      );
      assert(/click on the first atom/i.test(measure), `no measurement prompt: ${measure.slice(0, 80)}`);

      await run(page, 'wizard appearance', 2000);
      const appearance = await page.evaluate(
        () => document.querySelector('[class*="wiz"]')?.textContent ?? '',
      );
      assert(/Appearance/.test(appearance), 'appearance panel did not render');
      assert(/Done/.test(appearance), 'appearance panel has no Done button');

      // A panel button must reach the backend, not just re-render.
      //
      // Assert on the POP, not on the stack emptying: PyMOL stacks wizards, so
      // `Done` on `appearance` leaves the `measurement` wizard underneath and
      // `cmd.get_wizard() is None` is correctly False. A first version of this
      // spec asserted None and failed for that reason — the product was right.
      const top = await ask(page, 'cmd.get_wizard().__class__.__name__');
      assert(top === 'Appearance', `expected Appearance on top, got ${top}`);
      await page.locator('.wizards').getByText('Done', { exact: true }).first().click();
      await page.waitForTimeout(1600);
      const after = await ask(page, 'cmd.get_wizard().__class__.__name__');
      assert(after !== 'Appearance', `Done did not pop the wizard (still ${after})`);
      await page.close();
    },
  },
  {
    /**
     * A builder fragment button does NOT build immediately — it arms the attach
     * wizard, which is PyMOL's real behaviour. The full path is therefore
     * button -> wizard -> "Create As New Object" -> a real object with the right
     * atom count. Asserting the count is what distinguishes "a fragment was
     * built" from "something was created".
     */
    name: 'a builder fragment arms the attach wizard and builds a real molecule',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      // Two buttons say "Builder": the overlay launcher and PyMOL's own quick
      // buttons row. Scope to the launcher.
      await page
        .locator('.overlay-launcher__btn')
        .filter({ hasText: /^Builder$/ })
        .first()
        .click();
      await page.waitForTimeout(700);
      await page.locator('.builder-launch').click();
      await page.waitForTimeout(1400);

      await page.getByRole('button', { name: 'Benzene', exact: true }).first().click();
      await page.waitForTimeout(1500);
      const armed = await page.evaluate(() => document.body.innerText);
      assert(/attach phenyl/i.test(armed), 'fragment button did not arm the attach wizard');

      await page.getByText('Create As New Object', { exact: false }).first().click();
      await page.waitForTimeout(2400);

      // Count the NEW object, not "all". Every spec shares one PyMOL process,
      // so a global count picks up whatever an earlier spec loaded — this
      // asserted 12 and got 11390, which was 1tii plus the benzene.
      const objects = await ask(page, 'cmd.get_names("objects")');
      assert(objects !== '[]', 'no object was created');
      const atoms = await ask(page, 'cmd.count_atoms(cmd.get_names("objects")[-1])');
      assert(atoms === '12', `benzene should be 12 atoms (C6H6), got ${atoms}`);
      await page.close();
    },
  },
  {
    /**
     * Movie transport and scene recall. Both are camera/frame state that must
     * round-trip through PyMOL, so both assert on backend state rather than on
     * the control lighting up.
     *
     * Buttons are matched by TITLE: two of the nine are labelled `>` (play and
     * forward), so matching on text picks play and the frame advances by
     * however long the assertion waited.
     */
    name: 'movie transport steps frames and a scene recalls the camera',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });
      await run(page, 'load packages/engine/test/dat/1tii.pdb, mv', 2400);
      await run(page, 'mset 1 x30', 1400);
      await run(page, 'frame 5', 1200);

      await page.locator('button[title^="forward one frame"]').first().click();
      await page.waitForTimeout(1200);
      assert((await ask(page, 'cmd.get_frame()')) === '6', 'forward did not step exactly one frame');

      await page.locator('button[title^="rewind"]').first().click();
      await page.waitForTimeout(1200);
      assert((await ask(page, 'cmd.get_frame()')) === '1', 'rewind did not return to frame 1');

      // Scene recall ANIMATES by default, so a sample taken while the camera is
      // still interpolating reads a value that is neither the old one nor the
      // new one — this assertion first failed with 0.828 between 0.137 and the
      // stored view. Disable the animation rather than sleeping and hoping.
      await run(page, 'set scene_animation_duration, 0', 1000);
      await run(page, 'scene S1, store', 1400);
      const stored = await ask(page, 'round(cmd.get_view()[0], 3)');
      await run(page, 'turn y, 60', 1200);
      const turned = await ask(page, 'round(cmd.get_view()[0], 3)');
      assert(turned !== stored, 'turn did not move the camera; the recall test would be vacuous');

      await page.locator('.scpanel').getByText('S1', { exact: true }).first().click();
      await page.waitForTimeout(1600);
      const recalled = await ask(page, 'round(cmd.get_view()[0], 3)');
      assert(recalled === stored, `scene recall did not restore the camera (${turned} -> ${recalled})`);
      await page.close();
    },
  },
  {
    /**
     * The sequence viewer's whole job is turning a click into a selection.
     *
     * Also pins CELL WIDTH, which is not cosmetic: `.seqrow__line` is a flex row
     * and cells set their width inline, so without `flex: 0 0 auto` 928 cells
     * asking for 8px inside a ~1056px row shrink to ~1px. That renders the
     * sequence as an illegible band AND makes every cell too narrow to click —
     * a centre click lands on a neighbour.
     */
    name: 'a sequence viewer cell is clickable and selects that residue',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });
      await run(page, 'load packages/engine/test/dat/1tii.pdb, sq', 2400);
      await run(page, 'set seq_view, 1', 1800);

      const width = await page.evaluate(() => {
        const cell = document.querySelector('.seqcell');
        return cell ? Math.round(cell.getBoundingClientRect().width) : -1;
      });
      assert(width >= 6, `sequence cells collapsed to ${width}px; they are unclickable below ~6px`);

      const before = await ask(page, 'cmd.count_atoms("sele")');
      await page.locator('.seqcell').nth(40).click();
      await page.waitForTimeout(1500);
      const selections = await ask(page, 'cmd.get_names("selections")');
      assert(selections.includes('sele'), `no selection was made (${before} -> ${selections})`);
      await page.close();
    },
  },
  {
    /**
     * Colour is verified by COUNTING ATOMS per colour rather than reading one
     * atom's colour index: `cmd.get_model(...)` produces no output through the
     * console path, and an index alone would not show that the whole selection
     * was recoloured.
     */
    name: 'picking a colour from the C menu recolours the selection',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });
      await run(page, 'load packages/engine/test/dat/1tii.pdb, cl', 2400);
      await run(page, 'color green, cl', 1500);

      // Scope to THIS object. Counting globally picks up other specs' objects,
      // whose oxygens are red by default — the first run expected 5684 and got
      // 28442.
      const green = await ask(page, "cmd.count_atoms('cl and color green')");
      assert(Number(green) > 0, `nothing was green to begin with (${green})`);
      assert(
        (await ask(page, "cmd.count_atoms('cl and color red')")) === '0',
        'this object was already red',
      );

      await page
        .locator('.overlay-launcher__btn')
        .filter({ hasText: /Colour|Color/ })
        .first()
        .click();
      await page.waitForTimeout(700);
      await page.locator('.colors-launch').click();
      await page.waitForTimeout(1400);
      await page.getByText('red', { exact: true }).first().click();
      await page.waitForTimeout(2000);

      const red = await ask(page, "cmd.count_atoms('cl and color red')");
      assert(red === green, `expected all ${green} atoms red, got ${red}`);
      await page.close();
    },
  },
  {
    /**
     * Input plumbing: the ButMode block and the global key bridge.
     *
     * The key half must blur the command line first. The service ignores keys
     * typed into a text entry, which is correct — arrows should navigate frames,
     * not fight the console — but it means a naive press does nothing and looks
     * like a broken binding.
     */
    name: 'the ButMode block cycles and arrow keys reach PyMOL',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });
      await run(page, 'load packages/engine/test/dat/1tii.pdb, ip', 2400);

      const mode = await ask(page, "cmd.get('button_mode_name')");
      await page.locator('.butmode-host').first().click();
      await page.waitForTimeout(1300);
      const cycled = await ask(page, "cmd.get('button_mode_name')");
      assert(cycled !== mode, `clicking ButMode did not cycle the ring (stayed ${mode})`);

      const level = await ask(page, "cmd.get('mouse_selection_mode')");
      await page.getByText(/^Selecting/).first().click();
      await page.waitForTimeout(1300);
      const levelAfter = await ask(page, "cmd.get('mouse_selection_mode')");
      assert(levelAfter !== level, `the Selecting line did not cycle the level (stayed ${level})`);

      await run(page, 'mset 1 x30', 1200);
      await run(page, 'frame 5', 1200);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(1400);
      assert((await ask(page, 'cmd.get_frame()')) === '6', 'ArrowRight did not advance the frame');
      await page.close();
    },
  },
  {
    /**
     * THE CROSS-PLATFORM CLAIM, end to end.
     *
     * A bridge with no GL context is what a Linux box without EGL or a Windows
     * box without WGL looks like. Everything here must hold with the server
     * never calling `PyMOL_Draw`:
     *
     *   - the scene renders, client-side, from PyMOL's own geometry
     *   - the camera responds to a drag, via RPC rather than forwarded input,
     *     because raw `{t:'input'}` is queued behind a flag only a draw sets
     *   - a click selects an atom, via the local pick index, because PyMOL's
     *     own pick pass renders a colour buffer it cannot produce
     *
     * `viewportPull=off` is REQUIRED: with the dev PNG-pull fallback on, a
     * GL-free bridge still shows a picture at ~1 fps because `cmd.png(ray=0)`
     * silently ray-traces, and Mode G stays suppressed. That looks like
     * success and is not.
     */
    name: 'GL-free: renders, drags and picks with the server never drawing',
    async fn({ noGl, assert }) {
      const stack = await noGl();
      const page = await openApp(stack, { query: '?viewportHandle=1&viewportPull=off' });
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      const health = await (await fetch(stack.healthz)).json();
      assert(health.gl?.available === false, 'this stack was supposed to have no GL');

      await run(page, 'load packages/engine/test/dat/1tii.pdb, gf', 2600);
      await run(page, 'hide everything', 900);
      await run(page, 'show cartoon', 1800);
      await run(page, 'orient', 1600);
      await page.waitForTimeout(2500);
      // The capability probe answers `no-accessor` on the first request; retry.
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.__tenmolViewport.setRepMode(5, 'geometry'));
        await page.waitForTimeout(2200);
      }

      const stats = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.__tenmolViewport.stats)),
      );
      assert(stats.composition.rasterizing === false, 'the server is still rasterising');
      assert(stats.geometryTriangles > 1000, `nothing drawn client-side (${stats.geometryTriangles})`);

      const box = await page.locator('canvas').first().boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Camera: a drag must move the view even though raw input cannot.
      const before = await ask(page, 'round(cmd.get_view()[0], 4)');
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let k = 1; k <= 12; k++) {
        await page.mouse.move(cx + k * 8, cy);
        await page.waitForTimeout(45);
      }
      await page.mouse.up();
      await page.waitForTimeout(1600);
      assert((await ask(page, 'round(cmd.get_view()[0], 4)')) !== before, 'the camera did not move');

      const rpc = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.__tenmolViewport.cameraRpc)),
      );
      assert(rpc.turns > 0, 'no camera RPCs were issued');
      assert(rpc.errors === 0, `camera RPCs failed: ${rpc.errors}`);

      // Picking: click across the structure; at least one must select an atom.
      for (const [fx, fy] of [
        [0.3, 0.35],
        [0.35, 0.5],
        [0.65, 0.5],
        [0.5, 0.65],
      ]) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        await page.waitForTimeout(400);
      }
      const pick = await page.evaluate(() =>
        JSON.parse(JSON.stringify(window.__tenmolViewport.localPick)),
      );
      assert(pick.index.keys > 0, 'the pick index is empty; no geometry was indexed');
      assert(pick.hits > 0, `every click missed (${pick.attempts} attempts)`);
      assert((await ask(page, "cmd.count_atoms('sele')")) !== '0', 'no atom was selected');

      // And the server never drew, for the whole run.
      const after = await (await fetch(stack.healthz)).json();
      assert(after.draws === 0, `the server drew ${after.draws} times`);
      await page.close();
    },
  },
  {
    /**
     * The Text Editor writing to the PyMOL host.
     *
     * This is the spec that would have caught the bug it now guards:
     * `features/texteditor/files.ts` called `_bridge.read_text_file` and
     * `_bridge.write_text_file`, and NEITHER ROUTE EXISTS. Every server open
     * and save failed, the panel silently fell back to the browser file
     * picker, and "edit your pymolrc in place" — the point of the feature —
     * did nothing. Nothing failed loudly, so nothing noticed.
     *
     * Driving it through the UI is the whole value here: the panel only takes
     * the server path if `probeServerFiles` succeeds, so this asserts the
     * probe, the write and the read back through PyMOL in one go.
     */
    name: 'the text editor saves to a real file on the PyMOL host',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      /*
       * The editor is a HOSTED WINDOW, not an overlay panel: the `texteditor`
       * slot renders whatever `useHostedWindows` lists, and windows are opened
       * from the Dialogs panel. Clicking the overlay launcher labelled "Text
       * editor" mounts the host with zero windows in it — which is what the
       * first version of this spec did, and why it timed out on the textarea.
       */
      await page.getByRole('button', { name: 'Dialogs', exact: true }).click();
      await page.waitForTimeout(800);
      await page.locator('[data-open="texteditor"]').click();
      await page.waitForTimeout(1500);

      const area = page.locator('textarea.txted__area');
      await area.waitFor({ state: 'visible', timeout: 10_000 });

      // "bridge fs" means probeServerFiles found the route. Before the fix
      // this read "browser fs" and every assertion below was unreachable.
      const access = (await page.locator('.txted__access').first().innerText()).trim();
      assert(access === 'bridge fs', `editor is not using the server fs (${access})`);

      const body = '# tenmol e2e\nset sphere_scale, 0.42\n';
      await area.fill(body);

      const target = `${stack.tmp ?? '/tmp'}/tenmol-e2e-editor.pml`;
      page.once('dialog', (dialog) => void dialog.accept(target));
      await page.locator('[data-txted-saveas]').click();
      await page.waitForTimeout(1500);

      const shown = (await page.locator('.txted__path').first().innerText()).trim();
      assert(shown === target, `path did not update after save (${shown})`);

      // Read it back THROUGH PYMOL, not through the panel that wrote it.
      const readBack = await ask(
        page,
        `open(${JSON.stringify(target)}).read().strip().splitlines()[-1]`,
      );
      assert(
        readBack.includes('sphere_scale, 0.42'),
        `the file on disk does not contain what was typed (${readBack})`,
      );

      // And it is really a file PyMOL can run.
      await ask(page, `cmd.do("@" + ${JSON.stringify(target)}) or "ran"`);
      await page.waitForTimeout(1200);
      const applied = await ask(page, "cmd.get('sphere_scale')");
      assert(applied.startsWith('0.42'), `running the saved script did nothing (${applied})`);

      await page.close();
    },
  },
  {
    /**
     * INVENTORY ROW 98 — the object panel's modifier gestures, in a browser.
     *
     * `packages/engine/layer3/Executive.cpp:15260-15332` gives a row seven different meanings
     * depending on which button is down and which modifiers are held. Wave 8
     * drove all seven as pointer events in jsdom and the row stayed partial for
     * one stated reason: none of the six MODIFIED ones had ever been driven by
     * a real browser against a real bridge, only plain left and a left band
     * drag had. This is that leg.
     *
     * Every assertion is on PyMOL's own state — the enabled-object list, the
     * camera matrix — never on a class name, because the claim is "the gesture
     * reached the engine and meant the right thing".
     *
     * `set animation, 0` first: `panelActions.zoom/center` send `animate=-1`,
     * which sweeps over `animation_duration` in `int(duration*30)` key frames
     * and returns BEFORE the camera moves. Sampling `get_view()` right after a
     * gesture would read a value that is neither the old one nor the new one.
     */
    name: 'object rows: the six modifier gestures reach PyMOL (row 98)',
    async fn({ stack, assert }) {
      /*
       * A TALLER WINDOW, and this is a finding rather than a convenience.
       *
       * The internal-gui column is a flex column and `.objpanel` shrinks inside
       * it. Measured at the suite's usual 1280x900, with six objects loaded:
       * `.objpanel` 36 px, its row list 19 px against a scrollHeight of 128,
       * while `.mvpanel` had grown 125 -> 221 the moment an object was enabled.
       * Every row is then reachable only through a 19 px scroll window that the
       * 30 Hz object poll can reset between the scroll and the click — which is
       * how this spec first failed, on a click that landed on the wizard panel.
       * At 1280x1400 `.objpanel` is 534 px and nothing scrolls.
       *
       * The squeeze is a real defect and belongs to whoever owns the column
       * (features/movie grows; features/objects and the shell shrink); it is
       * reported, not fixed here. This spec is about what the SEVEN GESTURES
       * mean, so it takes the window it needs and hit-tests every click anyway.
       */
      const page = await openApp(stack, { viewport: { width: 1280, height: 1400 } });
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      await run(page, 'set animation, 0', 800);
      await run(page, 'delete m98a or m98b', 700);
      await run(page, 'fragment ala, m98a', 1200);
      await run(page, 'fragment his, m98b', 1200);
      // Apart in MODEL space (`translate` defaults to camera space), so
      // "centre on this one" and "centre on that one" are distinguishable.
      await run(page, 'translate [25,0,0], m98b, camera=0', 1000);
      await run(page, 'disable m98a', 600);
      await run(page, 'disable m98b', 900);

      /**
       * The centre of a row, and PROOF that a click there hits that row.
       *
       * Two hazards, both hit while writing this:
       *
       *  - `.objrow__name-text`, NOT `.objrow__name`: the button also holds the
       *    row's caption, so its text is `m98a1/1` and an exact-name match on
       *    the button finds nothing.
       *  - `.objpanel__rows` is a flex child that gets SQUEEZED when a sibling
       *    of the internal-gui column grows (measured: enabling an object grew
       *    `.mvpanel` 125 -> 221 px and shrank `.objpanel` 132 -> 36, i.e. to
       *    one row). The clipped rows still report their full bounding box, so
       *    `boundingBox()` hands back coordinates that now belong to whatever
       *    moved into that space — the wizard launcher, in the run that found
       *    this. Hence `scrollIntoViewIfNeeded` first, and a hit test after: a
       *    gesture that would land on another widget FAILS here instead of
       *    silently proving nothing.
       */
      const rowBox = async (name) => {
        const row = page
          .locator('.objrow__name-text')
          .filter({ hasText: new RegExp(`^${name}$`) })
          .first();
        await row.waitFor({ state: 'visible', timeout: 15_000 });
        await row.scrollIntoViewIfNeeded();
        const box = await row.boundingBox();
        assert(box !== null, `row ${name} has no box`);
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const hit = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const own = el?.closest('.objrow');
            return own ? (own.textContent ?? '') : `NOT A ROW: ${el?.className ?? 'null'}`;
          },
          [point.x, point.y],
        );
        assert(hit.includes(name), `a click at the ${name} row would land on ${hit}`);
        return point;
      };

      /** One press-release on a row with modifiers held. */
      const gesture = async (name, { button = 'left', mods = [], to = null } = {}) => {
        const from = await rowBox(name);
        for (const key of mods) await page.keyboard.down(key);
        await page.mouse.move(from.x, from.y);
        await page.mouse.down({ button });
        if (to !== null) {
          const dest = await rowBox(to);
          // Several small steps: the panel recomputes the hovered row from
          // clientY on every move, and one jump would skip the band.
          for (let i = 1; i <= 6; i++) {
            await page.mouse.move(from.x, from.y + ((dest.y - from.y) * i) / 6);
            await page.waitForTimeout(60);
          }
        }
        await page.mouse.up({ button });
        for (const key of [...mods].reverse()) await page.keyboard.up(key);
        await page.waitForTimeout(1400);
      };

      const enabled = async () => await ask(page, 'cmd.get_names("objects",1)');
      const view = async () => await ask(page, '[round(v,3) for v in cmd.get_view()]');

      // 1. SHIFT + left — immediate toggle.
      assert(!(await enabled()).includes('m98a'), 'm98a should have started disabled');
      await gesture('m98a', { mods: ['Shift'] });
      assert((await enabled()).includes('m98a'), 'shift+left did not enable the row');
      await gesture('m98a', { mods: ['Shift'] });
      assert(!(await enabled()).includes('m98a'), 'shift+left did not toggle back off');

      // 2. CTRL + left dragged onto another row — hover-activate: enable only
      // the row under the pointer, disabling the one it activated before.
      await gesture('m98a', { mods: ['Control'], to: 'm98b' });
      const afterHover = await enabled();
      assert(
        afterHover.includes('m98b') && !afterHover.includes('m98a'),
        `ctrl-drag should leave only m98b enabled, got ${afterHover}`,
      );

      // 3. CTRL+SHIFT + left — hover-activate AND zoom.
      const beforeZoom = await view();
      await gesture('m98a', { mods: ['Control', 'Shift'] });
      const afterZoom = await enabled();
      assert(afterZoom.includes('m98a'), `ctrl+shift+left did not activate (${afterZoom})`);
      assert((await view()) !== beforeZoom, 'ctrl+shift+left did not zoom the camera');

      // 4. MIDDLE — centre and activate. The origin is `get_view()[12:15]`.
      await run(page, 'disable m98b', 700);
      const originBefore = await ask(page, '[round(v,1) for v in cmd.get_view()[12:15]]');
      await gesture('m98b', { button: 'middle' });
      const afterMiddle = await enabled();
      assert(afterMiddle.includes('m98b'), `middle click did not activate (${afterMiddle})`);
      const originAfter = await ask(page, '[round(v,1) for v in cmd.get_view()[12:15]]');
      assert(
        originAfter !== originBefore,
        `middle click did not centre (origin stayed ${originBefore})`,
      );

      // 5. CTRL + middle — zoom and activate.
      await run(page, 'disable m98a', 700);
      const beforeCtrlMiddle = await view();
      await gesture('m98a', { button: 'middle', mods: ['Control'] });
      const afterCtrlMiddle = await enabled();
      assert(afterCtrlMiddle.includes('m98a'), `ctrl+middle did not activate (${afterCtrlMiddle})`);
      assert((await view()) !== beforeCtrlMiddle, 'ctrl+middle did not move the camera');

      // 6. CTRL+SHIFT + middle — disable everything, then enable only this one.
      // The only gesture in the panel with a GLOBAL effect, so the assertion is
      // global too: nothing else in the session may still be on.
      await run(page, 'enable m98a', 700);
      await gesture('m98b', { button: 'middle', mods: ['Control', 'Shift'] });
      const solo = await enabled();
      assert(
        solo.replace(/\s+/g, '') === "['m98b']",
        `ctrl+shift+middle should leave exactly one object enabled, got ${solo}`,
      );

      // Leave the shared engine as it was found: `animation` is global.
      await run(page, 'set animation, 1', 600);
      await run(page, 'delete m98a or m98b', 600);
      await page.close();
    },
  },
  {
    /**
     * THE INTERNAL-GUI COLUMN MUST NOT STARVE THE OBJECT LIST.
     *
     * A measured product defect, not a parity row. At the suite's own 1280x900,
     * `.internal-gui` is 644 px and `.objpanel` used to be the only child with
     * `flex-basis: 0` — the residual — with `min-height: 0`. MEASURED before
     * the fix:
     *
     *     empty session          objpanel 132  mvpanel 125  scpanel 217
     *     + 6 objects, mset x30  objpanel  34  mvpanel 223  scpanel 217
     *                            .objpanel__rows 17 px against scrollHeight 128
     *                            7 rows rendered, 1 REACHABLE
     *     + 3 scenes stored      objpanel   0
     *                            7 rows rendered, 0 REACHABLE
     *
     * Every clipped row still reported a full bounding box, so `toBeVisible`
     * was true for all seven and a user could click none. That is why this spec
     * HIT-TESTS: `document.elementFromPoint` at each row's centre must find
     * that row, and then a real click on the last row must reach PyMOL.
     *
     * The fix and its justification: `shell/orthoPanel.ts: EXECUTIVE_MIN_HEIGHT`
     * (144 px = `controlHeight` 20 + the larger `ButModeGetHeight` 124), with
     * the PyMOL heights it is measured against in
     * `packages/bridge/tests/test_p11_layout.py` (the Executive block is 584 px of a
     * 644 px column upstream; the scene bin reserves 0).
     *
     * NOTHING HERE IS COSMETIC. Every assertion is "a user can reach this",
     * which is the one thing jsdom cannot answer — it lays nothing out, so all
     * five numbers above read as 0 there.
     */
    name: 'the internal-gui column keeps the object list reachable (measured defect)',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      /** Everything the column reports about itself, in one round trip. */
      const survey = () =>
        page.evaluate(() => {
          const col = document.querySelector('.internal-gui');
          if (!col) return null;
          const boxOf = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
              h: Math.round(el.getBoundingClientRect().height),
              client: el.clientHeight,
              scroll: el.scrollHeight,
              overflowY: cs.overflowY,
              minHeight: cs.minHeight,
            };
          };
          // A row is REACHABLE when a click at its centre lands on it. Not
          // "visible": the clipped rows this spec exists for had full bounding
          // boxes and belonged to nobody.
          //
          // TWO PASSES, and the order matters. The first is taken with the list
          // scrolled to the top and answers "how many rows can be clicked with
          // no scrolling at all" — the floor's whole purpose, and 0 before the
          // fix. The second scrolls each row into view first and answers "can
          // this row be reached at all", which must hold for every row however
          // long the session's object list has grown.
          const rowEls = [...document.querySelectorAll('.objrow')];
          const list = document.querySelector('.objpanel__rows');
          if (list) list.scrollTop = 0;
          const rows = rowEls.map((row) => {
            const b = row.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return {
              text: (row.textContent ?? '').slice(0, 12),
              reached: hit instanceof HTMLElement && hit.closest('.objrow') === row,
            };
          });
          const scrolled = rowEls.map((row) => {
            row.scrollIntoView({ block: 'center', inline: 'nearest' });
            const b = row.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return {
              text: (row.textContent ?? '').slice(0, 12),
              reached: hit instanceof HTMLElement && hit.closest('.objrow') === row,
            };
          });
          // Controls in the two panels that YIELD. Scrolled into view first,
          // because a panel that shrinks is allowed to scroll — it is not
          // allowed to clip, which no amount of scrolling can undo.
          const controls = [...document.querySelectorAll('.mvpanel button, .scpanel button')]
            .filter((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 0 && b.height > 0;
            })
            .map((el) => {
              el.scrollIntoView({ block: 'center', inline: 'nearest' });
              const b = el.getBoundingClientRect();
              const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
              return {
                label: (el.textContent ?? '?').slice(0, 16),
                reached: hit === el || (hit instanceof HTMLElement && el.contains(hit)),
              };
            });
          // A block whose content overflows a `hidden` box is unreachable by
          // any gesture. This is the shape of the original defect.
          const clipped = [...col.children]
            .map((el) => ({ el, cs: window.getComputedStyle(el) }))
            .filter(
              ({ el, cs }) => cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight,
            )
            .map(({ el }) => el.className.split(' ')[0]);
          return {
            column: Math.round(col.getBoundingClientRect().height),
            objpanel: boxOf('.objpanel'),
            objrows: boxOf('.objpanel__rows'),
            mvpanel: boxOf('.mvpanel'),
            scpanel: boxOf('.scpanel'),
            rows,
            scrolled,
            controls,
            clipped,
          };
        });

      try {
        await run(page, 'delete p11l*', 800);
        for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
          await run(page, `load ${PDB}, p11l_${n}`, 900);
        }
        await run(page, 'mset 1 x30', 900);
        await run(page, 'scene p11l_s1, store', 700);
        await run(page, 'scene p11l_s2, store', 700);
        await run(page, 'scene p11l_s3, store', 900);

        const s = await survey();
        assert(s !== null, 'no .internal-gui column');
        const shape = JSON.stringify({
          column: s.column,
          objpanel: s.objpanel,
          objrows: s.objrows,
          mvpanel: s.mvpanel,
          scpanel: s.scpanel,
        });

        // 1. THE FLOOR. `EXECUTIVE_MIN_HEIGHT`, and the panel that carries it
        //    must be tall enough to hold it plus its own 17 px head.
        assert(s.objrows !== null, 'no .objpanel__rows');
        assert(
          s.objrows.client >= 144,
          `the object list is ${s.objrows.client} px, below the 144 px floor — ${shape}`,
        );
        assert(
          s.objpanel.client >= 161,
          `.objpanel is ${s.objpanel.client} px, below head + floor = 161 — ${shape}`,
        );

        // 2. NOTHING IS CLIPPED OUT OF REACH.
        assert(
          s.clipped.length === 0,
          `clipped with overflow:hidden: ${s.clipped.join(', ')} — ${shape}`,
        );

        // 3. ROWS. Seven at least: `all` plus the six objects loaded above.
        //    Earlier specs in this file leave their own objects behind and the
        //    suite may be reordered, so the count is a floor, not an equality.
        assert(s.rows.length >= 7, `only ${s.rows.length} object rows rendered`);

        //    3a. THE FLOOR, EXPRESSED AS ROWS: 144 px of `ExecLineHeight` (18)
        //        is eight rows, and all eight must be clickable with no
        //        scrolling whatsoever. MEASURED before the fix: ZERO were.
        const want = Math.min(8, s.rows.length);
        const reachedNoScroll = s.rows.filter((r) => r.reached).length;
        assert(
          reachedNoScroll >= want,
          `only ${reachedNoScroll} of ${s.rows.length} rows can be clicked without ` +
            `scrolling; the 144 px floor is ${want} rows — ${shape}`,
        );
        //        …and they must be the FIRST ones, not eight scattered hits.
        const firstBad = s.rows.slice(0, want).findIndex((r) => !r.reached);
        assert(
          firstBad === -1,
          `row ${firstBad} (${s.rows[firstBad]?.text}) is inside the floor and ` +
            `unreachable — ${shape}`,
        );

        //    3b. AND EVERY ROW IS REACHABLE, scrolling included. A list longer
        //        than its panel is allowed to scroll — PyMOL's own Executive
        //        block does, `packages/engine/layer3/Executive.cpp:16219-16224`. It is not
        //        allowed to render a row that belongs to nobody.
        const unreachable = s.scrolled.filter((r) => !r.reached).map((r) => r.text);
        assert(
          unreachable.length === 0,
          `${unreachable.length} of ${s.scrolled.length} rows are rendered but cannot be ` +
            `reached even after scrolling (${unreachable.join(', ')}) — ${shape}`,
        );

        // 4. WHAT YIELDED IS STILL REACHABLE, by scrolling rather than by luck.
        const badControls = s.controls.filter((c) => !c.reached).map((c) => c.label);
        assert(
          badControls.length === 0,
          `${badControls.length} of ${s.controls.length} movie/scene controls cannot be ` +
            `reached even after scrolling (${badControls.join(', ')}) — ${shape}`,
        );

        // 5. AND A REAL CLICK ON THE LAST ROW REACHES PyMOL. The strongest
        //    form of "reachable": PyMOL's own enabled-object list changes.
        await run(page, 'disable p11l_f', 800);
        assert(
          !(await ask(page, 'cmd.get_names("objects",1)')).includes('p11l_f'),
          'p11l_f did not start disabled',
        );
        const row = page
          .locator('.objrow__name-text')
          .filter({ hasText: /^p11l_f$/ })
          .first();
        await row.waitFor({ state: 'visible', timeout: 15_000 });
        // The list is allowed to scroll — earlier specs leave their objects in
        // the shared session, and this one is last.
        await row.scrollIntoViewIfNeeded();
        const box = await row.boundingBox();
        assert(box !== null, 'the p11l_f row has no box');
        const hit = await page.evaluate(
          ([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const own = el instanceof HTMLElement ? el.closest('.objrow') : null;
            return own ? (own.textContent ?? '') : `NOT A ROW: ${el?.className ?? 'null'}`;
          },
          [box.x + box.width / 2, box.y + box.height / 2],
        );
        assert(hit.includes('p11l_f'), `a click on the p11l_f row would land on ${hit}`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1400);
        assert(
          (await ask(page, 'cmd.get_names("objects",1)')).includes('p11l_f'),
          'clicking the last object row did not enable it in PyMOL',
        );
      } finally {
        // The bridge is shared by all 20 specs: scenes and a movie are global.
        for (const n of ['p11l_s1', 'p11l_s2', 'p11l_s3']) {
          await run(page, `scene ${n}, delete`, 500);
        }
        await run(page, 'mset', 500);
        await run(page, 'delete p11l*', 700);
        await page.close();
      }
    },
  },
  {
    /**
     * Row 341 item (2) — `seq_view_overlay = 0` RESERVES SCENE SPACE.
     *
     * `OrthoReshape` takes the sequence viewer's height out of the scene
     * rectangle when overlay is off (`packages/engine/layer1/Ortho.cpp:2419` `sceneBottom +=
     * seqHeight`, `:2433` `sceneTop = seqHeight`). This client drew the strip
     * `position: absolute` over the canvas and changed only its background
     * opacity, so the setting did nothing you could measure: MEASURED before
     * the fix, the canvas was `top 24, bottom 668, height 644` in ALL FOUR
     * combinations of overlay 0/1 by location 0/1, identical to the pixel.
     *
     * THIS CANNOT BE A JSDOM TEST. Every number below comes from a real layout;
     * in jsdom they are all 0. `p12reserve.dom.test.ts` covers the arithmetic.
     */
    name: 'seq_view_overlay 0 shrinks the scene instead of covering it (row 341)',
    async fn({ stack, assert }) {
      const page = await openApp(stack);
      await page.locator(CMDLINE).waitFor({ state: 'visible', timeout: 20_000 });

      /** The canvas box and the strip box, in one round trip. */
      const survey = () =>
        page.evaluate(() => {
          const box = (sel) => {
            const n = document.querySelector(sel);
            if (!n) return null;
            const r = n.getBoundingClientRect();
            return {
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              height: Math.round(r.height),
            };
          };
          // `.viewport` and not the `<canvas>`: the canvas carries no class,
          // and `.viewport` is the `flex: 1` box that absorbs the padding —
          // i.e. it IS the scene rectangle in the browser's units.
          return { canvas: box('.viewport'), strip: box('.seqview') };
        });

      try {
        await run(page, 'load packages/engine/test/dat/pept.pdb, p12seq', 2400);
        // ESTABLISH the baseline, do not assume it. All 21 specs share one
        // bridge and `seq_view` is a GLOBAL setting: the sequence-viewer spec
        // above turns it on and leaves it on, so this one arrived to a strip
        // already up and failed on its first assertion — passing alone and
        // failing in the suite, which is the shared-process trap this file
        // documents everywhere else.
        await run(page, 'set seq_view, 0', 1200);
        const bare = await survey();
        assert(bare.strip === null, 'the strip is up after seq_view 0');
        assert(bare.canvas.height > 100, `no canvas to measure (${JSON.stringify(bare.canvas)})`);

        // OVERLAY ON: draws over the picture, takes nothing.
        await run(page, 'set seq_view_overlay, 1', 600);
        await run(page, 'set seq_view, 1', 1600);
        const overlay = await survey();
        assert(overlay.strip !== null, 'the sequence viewer never appeared');
        assert(
          overlay.canvas.height === bare.canvas.height,
          `overlay=1 must not resize the scene (${bare.canvas.height} -> ${overlay.canvas.height})`,
        );

        // OVERLAY OFF, TOP: `sceneTop = seqHeight`.
        await run(page, 'set seq_view_overlay, 0', 1400);
        const top = await survey();
        const reserved = bare.canvas.height - top.canvas.height;
        assert(
          reserved === top.strip.height,
          `the scene gave up ${reserved}px for a ${top.strip.height}px strip`,
        );
        assert(
          top.canvas.top === bare.canvas.top + top.strip.height,
          `the canvas did not start below the strip (${top.canvas.top} vs ${bare.canvas.top}+${top.strip.height})`,
        );
        // ...and the strip still sits flush against the edge, in the band the
        // canvas gave up rather than below it.
        assert(
          top.strip.top === bare.canvas.top,
          `the strip left a gap above it (${top.strip.top} vs ${bare.canvas.top})`,
        );

        // OVERLAY OFF, BOTTOM: `sceneBottom += seqHeight`, the other branch.
        await run(page, 'set seq_view_location, 1', 1400);
        const bottom = await survey();
        assert(
          bare.canvas.height - bottom.canvas.height === bottom.strip.height,
          `location=1 reserved ${bare.canvas.height - bottom.canvas.height}px for ${bottom.strip.height}px`,
        );
        assert(
          bottom.canvas.top === bare.canvas.top,
          'location=1 must take the band off the BOTTOM, not the top',
        );
        assert(
          bottom.canvas.bottom === bare.canvas.bottom - bottom.strip.height,
          `the canvas did not end above the strip (${bottom.canvas.bottom})`,
        );

        // AND IT GIVES THE SPACE BACK. A reservation that outlives its viewer
        // is a black band with no visible cause.
        await run(page, 'set seq_view, 0', 1600);
        const gone = await survey();
        assert(gone.strip === null, 'the strip is still up');
        assert(
          gone.canvas.height === bare.canvas.height,
          `the scene kept ${bare.canvas.height - gone.canvas.height}px reserved for a viewer that is gone`,
        );
      } finally {
        // The bridge is shared by all 21 specs: these are global settings.
        await run(page, 'set seq_view, 0', 400);
        await run(page, 'set seq_view_location, 0', 400);
        await run(page, 'set seq_view_overlay, 0', 400);
        await run(page, 'delete p12seq', 600);
        await page.close();
      }
    },
  },
];
