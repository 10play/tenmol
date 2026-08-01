/**
 * `OrthoLayoutPanel`, the control gutter, and the rule for believing PyMOL.
 *
 * Parity inventory rows 88 and 103, plus the two pieces of row 53 that are
 * arithmetic rather than DOM.
 *
 * Every number here has a MEASURED counterpart in
 * `bridge/tests/test_wf_shell.py`, run against the real engine over the socket:
 * the 220 px reservation, the 5 px floor, the fact that `cmd.set` does not
 * clamp, and setting 440 being `session_file`. This file pins the client-side
 * reimplementation; that file pins the backend it reimplements.
 */

import { describe, expect, it } from 'vitest';

import {
  BRIDGE_ZEROED,
  CLIENT_OWNED,
  GUTTER_DOUBLE_CLICK_MS,
  GUTTER_INITIAL,
  INTERNAL_GUI_MODE,
  INTERNAL_GUI_ORDER,
  ORTHO,
  adoptShellSettings,
  butModeHeight,
  clampInternalGuiWidth,
  gutterClick,
  gutterDrag,
  layoutInternalGui,
  qtInitialWindowSize,
  windowTitle,
  wizardHeight,
  type ShellSettings,
} from './orthoPanel';

describe('the block stack (row 88)', () => {
  it('stacks Control 20, ButMode 40, and gives the rest to Executive', () => {
    expect(layoutInternalGui({ height: 600, mouseGrid: false, wizardLines: 0 })).toEqual({
      executive: 600 - 20 - 40,
      wizard: 0,
      butMode: 40,
      control: 20,
    });
  });

  it('grows ButMode to 124 with mouse_grid, taking it out of Executive', () => {
    const stack = layoutInternalGui({ height: 600, mouseGrid: true, wizardLines: 0 });
    expect(stack.butMode).toBe(124);
    expect(stack.executive).toBe(600 - 20 - 124);
    // `ButModeGetHeight`, layer1/ButMode.cpp:72-78.
    expect([butModeHeight(false), butModeHeight(true)]).toEqual([40, 124]);
  });

  it('gives the Wizard block internal_gui_control_size * NLine + 4', () => {
    // layer1/Wizard.cpp:253-258. Default control size 18.
    expect(wizardHeight(0)).toBe(0);
    expect(wizardHeight(3)).toBe(18 * 3 + 4);
    expect(wizardHeight(3, 24)).toBe(24 * 3 + 4);
    expect(layoutInternalGui({ height: 600, mouseGrid: false, wizardLines: 3 })).toMatchObject({
      wizard: 58,
      executive: 600 - 20 - 40 - 58,
    });
  });

  it('collapses Executive rather than overlapping when the column is short', () => {
    const stack = layoutInternalGui({ height: 30, mouseGrid: true, wizardLines: 5 });
    expect(stack.executive).toBe(0);
    expect(stack.control).toBe(20);
  });

  it('orders the DOM Executive, Wizard, ButMode, Control — the portal lands 3rd', () => {
    // `features/shortcuts` portals `.butmode-host` into `.internal-gui`, which
    // APPENDS it. Without the CSS `order` below it renders under the movie
    // Control bar, upside down relative to OrthoLayoutPanel.
    const byOrder = Object.entries(INTERNAL_GUI_ORDER).sort((a, b) => a[1] - b[1]);
    expect(byOrder.map(([id]) => id)).toEqual([
      'objpanel',
      'wizards',
      'butmode-host',
      'mvpanel',
      'scpanel',
    ]);
  });

  it('knows internal_gui_mode 2 is the one that floats', () => {
    // MEASURED: modes 0 and 1 both leave an 800px window with a 580px scene at
    // width 220; mode 2 leaves it at 800.
    expect(INTERNAL_GUI_MODE).toEqual({ Default: 0, Bg: 1, Transparent: 2 });
  });
});

describe('the gutter (row 103)', () => {
  it('clamps to cControlMinWidth, which cmd.set does NOT', () => {
    // MEASURED: cmd.set('internal_gui_width', -20) sticks and the scene then
    // reports 820px inside an 800px window.
    expect(clampInternalGuiWidth(-20)).toBe(ORTHO.controlMinWidth);
    expect(clampInternalGuiWidth(0)).toBe(5);
    expect(clampInternalGuiWidth(3)).toBe(5);
    expect(clampInternalGuiWidth(5)).toBe(5);
    expect(clampInternalGuiWidth(220.4)).toBe(220);
    expect(clampInternalGuiWidth(10_000)).toBe(600);
    expect(clampInternalGuiWidth(Number.NaN)).toBe(ORTHO.internalGuiWidth);
  });

  it('needs two clicks inside 0.35 s to collapse', () => {
    const first = gutterClick(GUTTER_INITIAL, 1000);
    expect(first.changed).toBe(false);
    expect(first.state.width).toBe(220);

    const late = gutterClick(first.state, 1000 + GUTTER_DOUBLE_CLICK_MS);
    expect(late.changed).toBe(false);
    expect(late.state.width).toBe(220);
  });

  it('collapses to 5 and restores the saved width on the next double click', () => {
    const armed = gutterClick(GUTTER_INITIAL, 1000).state;
    const collapsed = gutterClick(armed, 1100);
    expect(collapsed.changed).toBe(true);
    expect(collapsed.state.width).toBe(ORTHO.controlMinWidth);
    expect(collapsed.state.savedWidth).toBe(220);

    const restored = gutterClick(collapsed.state, 1200);
    expect(restored.changed).toBe(true);
    expect(restored.state.width).toBe(220);
    expect(restored.state.savedWidth).toBe(0);
  });

  it('a drag clears SaveWidth, so the next double click collapses again', () => {
    // `I->SaveWidth = 0` in CControl::drag (layer1/Control.cpp:272). Without it
    // a double click after a drag would restore a width the user moved away
    // from, which is the bug the C++ avoids.
    const collapsed = gutterClick(gutterClick(GUTTER_INITIAL, 1000).state, 1100).state;
    expect(collapsed.savedWidth).toBe(220);

    const dragged = gutterDrag(collapsed, 300);
    expect(dragged.width).toBe(300);
    expect(dragged.savedWidth).toBe(0);

    const again = gutterClick(gutterClick(dragged, 2000).state, 2100);
    expect(again.state.width).toBe(ORTHO.controlMinWidth);
    expect(again.state.savedWidth).toBe(300);
  });

  it('clamps what a drag produces', () => {
    expect(gutterDrag(GUTTER_INITIAL, -40).width).toBe(ORTHO.controlMinWidth);
  });
});

describe('adopting PyMOL values (row 88)', () => {
  const read = (
    gui: number | null,
    width: number | null,
  ): ReadonlyArray<readonly [keyof ShellSettings, number | null]> => [
    ['internal_gui', gui],
    ['internal_gui_width', width],
  ];

  it('IGNORES the first internal_gui 0, because it is the bridge\u2019s', () => {
    // engine.py sets options.internal_gui = 0 AND cmd.set("internal_gui", 0).
    // Adopting that hides the whole right-hand column one second after
    // connecting — the same failure settingsAdopt.ts records for the console.
    expect(BRIDGE_ZEROED).toContain('internal_gui');
    const first = adoptShellSettings({}, read(0, 220));
    expect(first.patch.internal_gui).toBeUndefined();
    expect(first.remote.internal_gui).toBe(0);
  });

  it('adopts a LATER internal_gui change, including one back to 0', () => {
    const first = adoptShellSettings({}, read(0, 220));
    const on = adoptShellSettings(first.remote, read(1, 220));
    expect(on.patch.internal_gui).toBe(1);
    const off = adoptShellSettings(on.remote, read(0, 220));
    expect(off.patch.internal_gui).toBe(0);
  });

  it('adopts a non-zero first internal_gui: that one IS the user\u2019s .pymolrc', () => {
    expect(adoptShellSettings({}, read(1, 220)).patch.internal_gui).toBe(1);
  });

  it('does not adopt the first internal_gui_width — the browser owns it', () => {
    // The width lives in localStorage across restarts; PyMOL comes up at 220
    // every launch. The shell PUSHES its own value on first connect instead.
    expect(CLIENT_OWNED).toContain('internal_gui_width');
    const first = adoptShellSettings({}, read(0, 220));
    expect(first.patch.internal_gui_width).toBeUndefined();
    expect(first.remote.internal_gui_width).toBe(220);
  });

  it('adopts a width typed at the prompt, and ignores an unchanged echo', () => {
    const seeded = adoptShellSettings({}, read(0, 220)).remote;
    const typed = adoptShellSettings(seeded, read(0, 300));
    expect(typed.patch.internal_gui_width).toBe(300);
    const echo = adoptShellSettings(typed.remote, read(0, 300));
    expect(echo.patch).toEqual({});
  });

  it('treats a failed call as no answer, not as a value', () => {
    const seeded = adoptShellSettings({}, read(1, 220)).remote;
    const offline = adoptShellSettings(seeded, read(null, null));
    expect(offline.patch).toEqual({});
    expect(offline.remote).toEqual(seeded);
  });
});

describe('row 53 arithmetic', () => {
  it('reproduces the Qt initial size, which the shell deliberately does not use', () => {
    // MEASURED on the bridge: win_x/win_y/ext_y = 640/480/168 and
    // internal_gui/external_gui = 0/0, while the real surface is 800x600.
    expect(qtInitialWindowSize({ win_x: 640, win_y: 480, internal_gui: 0, external_gui: 0 })).toEqual(
      { width: 640, height: 498 },
    );
    expect(qtInitialWindowSize({ win_x: 640, win_y: 480, internal_gui: 1, external_gui: 1 })).toEqual(
      { width: 860, height: 726 },
    );
  });

  it('builds the window title from setting 440 the way Qt does', () => {
    expect(windowTitle('/tmp/wf_shell_title.pse')).toBe('PyMOL (wf_shell_title.pse)');
    expect(windowTitle('C:\\work\\x.pse')).toBe('PyMOL (x.pse)');
    // Qt only ever sets the title from a CHANGE callback, so an empty
    // session_file never produces "PyMOL ()".
    expect(windowTitle('')).toBe('PyMOL');
    expect(windowTitle(null)).toBe('PyMOL');
  });
});
