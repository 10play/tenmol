/**
 * Row 65 — the Stereo Mode table, checked against the engine's own numbers.
 *
 * Every constant below is pinned by `packages/bridge/tests/test_p11_menus.py`, which
 * issues all nine leaves against a GL-backed PyMOL and reads `stereo`,
 * `stereo_mode`, `chromadepth` and `stereo_shift` back. This file is the pure
 * half: the client's classification, and the sentences it produces.
 */

import { describe, expect, it } from 'vitest';
import { Rep } from '@tenmol/protocol/geometry';

import { MENU_DATA } from './generated/menudata';
import { UNAVAILABLE_COMMANDS } from './model';
import {
  STEREO_COMMANDS,
  STEREO_LEAVES,
  STEREO_UNAVAILABLE,
  clientRepsFrom,
  hasStereoLeaves,
  stereoLeaf,
  stereoNote,
  stereoScope,
  stereoTooltip,
} from './stereo';

/** The Stereo Mode submenu as the harvester produced it. */
function harvestedStereoCommands(): string[] {
  const display = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === 'Display');
  if (!display || display.kind !== 'submenu') throw new Error('no Display menu');
  const sub = display.items.find((n) => n.kind === 'submenu' && n.label === 'Stereo Mode');
  if (!sub || sub.kind !== 'submenu') throw new Error('no Stereo Mode submenu');
  return sub.items.flatMap((n) =>
    n.kind === 'command' && n.action.type === 'do' ? [n.action.command] : [],
  );
}

describe('row 65 — the table covers the real submenu, exactly', () => {
  it('classifies every leaf of the harvested Stereo Mode submenu and nothing else', () => {
    const harvested = harvestedStereoCommands();
    expect(harvested).toEqual([
      'stereo anaglyph',
      'stereo crosseye',
      'stereo walleye',
      'stereo quadbuffer',
      'stereo byrow',
      'stereo openvr',
      'stereo swap',
      'stereo chromadepth',
      'stereo off',
    ]);
    // Same set, so a harvest that gains or loses a leaf fails here rather than
    // shipping an unclassified one.
    expect([...STEREO_COMMANDS].sort()).toEqual([...harvested].sort());
  });

  it('agrees with `stereo_dict` (packages/engine/modules/pymol/constants.py:130-137)', () => {
    // The codes PyMOL's own parser resolves the words to.
    expect(Object.fromEntries(STEREO_COMMANDS.map((c) => [STEREO_LEAVES[c]!.word, STEREO_LEAVES[c]!.code]))).toEqual({
      anaglyph: 10,
      crosseye: 2,
      walleye: 3,
      quadbuffer: 1,
      byrow: 6,
      openvr: 13,
      swap: -1,
      chromadepth: -3,
      off: 0,
    });
  });

  it('records the four MEASURED end states, including the two labels that lie', () => {
    // packages/bridge/tests/test_p11_menus.py::test_stereo_leaves_do_exactly_what_the_client_table_says
    expect(STEREO_LEAVES['stereo anaglyph']).toMatchObject({ mode: 10, stereoOn: true });
    expect(STEREO_LEAVES['stereo byrow']).toMatchObject({ mode: 6, stereoOn: true });
    // `Chromadepth` is NOT a stereo mode: flag -3 turns stereo OFF.
    expect(STEREO_LEAVES['stereo chromadepth']).toMatchObject({
      mode: null,
      stereoOn: false,
      carrier: 'monoscopic',
    });
    // `Swap Sides` touches neither `stereo` nor `stereo_mode`.
    expect(STEREO_LEAVES['stereo swap']).toMatchObject({ mode: null, stereoOn: null });
  });

  it('refuses exactly the two whose second eye cannot cross the wire', () => {
    expect(Object.keys(STEREO_UNAVAILABLE).sort()).toEqual(['stereo openvr', 'stereo quadbuffer']);
    // …and those are the two non-compositing carriers, which is the RULE the
    // refusal follows rather than a hand-picked pair.
    const notComposite = STEREO_COMMANDS.filter(
      (c) => STEREO_LEAVES[c]!.carrier === 'two-buffers' || STEREO_LEAVES[c]!.carrier === 'hmd',
    );
    expect(notComposite.sort()).toEqual(['stereo openvr', 'stereo quadbuffer']);
    // `model.ts` re-exports them as the generic "command this client cannot run".
    expect(UNAVAILABLE_COMMANDS['stereo quadbuffer']).toBe(STEREO_UNAVAILABLE['stereo quadbuffer']);
    expect(UNAVAILABLE_COMMANDS['stereo anaglyph']).toBeUndefined();
  });

  it('quotes the engine as corroboration, not as the reason', () => {
    // MEASURED error text, `packages/bridge/tests/test_p11_menus.py::ENGINE_REFUSALS`.
    expect(STEREO_UNAVAILABLE['stereo quadbuffer']).toContain("no 'quadbuffer' support detected");
    expect(STEREO_UNAVAILABLE['stereo openvr']).toContain("'openvr' stereo mode not available");
    // The reason itself is the transport, and it survives a `pymol -S` build.
    expect(STEREO_UNAVAILABLE['stereo quadbuffer']).toContain('ONE image per frame');
  });

  it('finds the submenu inside the Display menu and nowhere else', () => {
    const display = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === 'Display');
    const file = MENU_DATA.menus.find((m) => m.kind === 'submenu' && m.label === 'File');
    expect(display?.kind === 'submenu' && hasStereoLeaves(display.items)).toBe(true);
    expect(file?.kind === 'submenu' && hasStereoLeaves(file.items)).toBe(false);
  });

  it('stereoLeaf is null for anything else', () => {
    expect(stereoLeaf('bg_color white')).toBeNull();
    expect(stereoLeaf('stereo sidebyside')).toBeNull(); // real word, not a menu leaf
  });
});

describe('row 65 — where the mode will be visible', () => {
  it('reads geometryReps out of a render_stats payload', () => {
    const stats = { modeP: { params: { geometryReps: [Rep.Cartoon, Rep.Cyl] } } };
    expect(clientRepsFrom(stats)).toEqual([Rep.Cartoon, Rep.Cyl]);
    expect(clientRepsFrom({ modeP: { params: { geometryReps: [] } } })).toEqual([]);
  });

  it('distinguishes "nothing declared" from "not asked"', () => {
    // An older bridge, or a call that failed: null, and it must not be reported
    // as "the server is drawing everything".
    expect(clientRepsFrom({})).toBeNull();
    expect(clientRepsFrom(null)).toBeNull();
    expect(stereoScope(null)).toBe('applies to whatever the server is drawing (Mode P)');
    expect(stereoScope([])).toBe(
      'the server is drawing the whole scene (Mode P), so this applies to all of it',
    );
  });

  it('names the reps the browser has taken over', () => {
    expect(stereoScope([Rep.Cartoon])).toBe(
      'cartoon is drawn by this browser (Mode G) and will NOT be in stereo',
    );
    expect(stereoScope([Rep.Cartoon, Rep.Cyl])).toBe(
      'cartoon, sticks are drawn by this browser (Mode G) and will NOT be in stereo',
    );
  });

  it('puts the effect and the scope in the tooltip, and nothing on a non-stereo leaf', () => {
    expect(stereoTooltip('stereo anaglyph', [])).toBe(
      'both eyes in one frame, split across the colour channels (red/cyan glasses) — ' +
        'the server is drawing the whole scene (Mode P), so this applies to all of it',
    );
    expect(stereoTooltip('bg_color white', [])).toBeNull();
  });
});

describe('row 65 — the console line after the click', () => {
  const ON = { stereo: 'on', stereoMode: '10' };
  const OFF = { stereo: 'off', stereoMode: '10' };

  it('says what took effect and where, when reps are client-drawn', () => {
    expect(stereoNote('stereo anaglyph', ON, [Rep.Cartoon])).toBe(
      ' stereo anaglyph: stereo on, stereo_mode 10 — cartoon is drawn by this browser (Mode G) ' +
        'and will NOT be in stereo; switch those reps back to P in the viewport HUD to see them in stereo',
    );
  });

  it('does not add the HUD advice when the server is drawing everything', () => {
    expect(stereoNote('stereo anaglyph', ON, [])).toBe(
      ' stereo anaglyph: stereo on, stereo_mode 10 — the server is drawing the whole scene ' +
        '(Mode P), so this applies to all of it',
    );
  });

  it('catches the engine refusing a mode, which `{t:do}` reports as ok', () => {
    // MEASURED: `stereo quadbuffer` replies ok and changes nothing. The leaf is
    // disabled in the menu, but a `do` typed at the prompt lands here too.
    expect(stereoNote('stereo quadbuffer', OFF, [])).toBe(
      ' stereo quadbuffer: the engine did not enable stereo (stereo is still off) — see the error above',
    );
  });

  it('says chromadepth is not stereo, and swap needs stereo on', () => {
    expect(stereoNote('stereo chromadepth', OFF, [])).toContain(
      'is not a stereo mode: it sets chromadepth 1 and turns stereo OFF',
    );
    expect(stereoNote('stereo swap', OFF, [])).toBe(
      ' stereo swap negated stereo_shift, but stereo is off, so nothing on screen changed',
    );
    // With stereo on it did something visible, so there is nothing to warn about.
    expect(stereoNote('stereo swap', ON, [])).toBeNull();
  });

  it('says the mode stays latched after `off`', () => {
    expect(stereoNote('stereo off', { stereo: 'off', stereoMode: '6' }, [])).toBe(
      ' stereo off — stereo_mode stays latched at 6',
    );
  });

  it('is silent for anything that is not a stereo leaf', () => {
    expect(stereoNote('bg_color white', ON, [])).toBeNull();
  });
});
