"""Area 1, wave 8: the menu leaves that were never EXERCISED in the engine.

Three parity rows ended with the same shape of gap — "harvested and asserted in
pytest, never clicked" (63), "proved to resolve in the engine, but never
clicked" (68), "the progress bar was never exercised under a long ray" (58) —
plus row 67's claim that the PgUp/PgDn bindings behind `Scene > Next/Previous`
are not wired.  The web side clicks the leaves
(`apps/web/src/features/menubar/p8a1clicks.dom.test.tsx`); this file is the
other half: the command strings those clicks emit, run against the live engine,
with the effect MEASURED rather than the absence of an exception asserted.

THE SUITE SHARES ONE PYMOL.  Everything below saves and restores what it
touches: the sculpting settings, the mouse ring, the camera, the scene bin and
the editor's pk1.  The one thing that cannot be undone is a created object, so
every object name here is prefixed `p8a1_` and deleted in a finally.
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List

from conftest import RunningBridge, WSClient

DATA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test",
    "dat",
)
IL2 = os.path.join(DATA, "il2.pdb")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def _settings(ws: WSClient, names: List[str]) -> Dict[str, Any]:
    """Current value of each setting, as `get_setting_tuple` reports it."""
    out: Dict[str, Any] = {}
    for name in names:
        tup = ws.call("cmd.get_setting_tuple", name)
        out[name] = tup[1][0]
    return out


def _restore(ws: WSClient, saved: Dict[str, Any]) -> None:
    for name, value in saved.items():
        ws.call("cmd.set", name, value, quiet=1)


def _echo_free(lines: List[str], tag: str) -> List[str]:
    """Feedback lines carrying ``tag`` MINUS PyMOL's echo of the command.

    PyMOL prints the command back before running it, so the line containing
    ``print('TAG', ...)`` is not output; only lines that start with the tag are.
    """
    return [line for line in lines if line.strip().startswith(tag)]


def _tagged(bridge: RunningBridge, ws: WSClient, tag: str, expr: str) -> List[str]:
    """Read an ATTRIBUTE (which the dispatcher cannot fetch) via a print."""
    ws.do("print('%s', %s)" % (tag, expr))
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    return _echo_free(lines, tag)


# --------------------------------------------------------------------------- #
# Row 63 — Build > Sculpting
# --------------------------------------------------------------------------- #

SCULPT_SETTINGS = ["auto_sculpt", "sculpting", "sculpting_cycles", "sculpt_field_mask"]


def test_sculpting_submenu_settings_take_every_value_the_menu_offers(
    ws: WSClient,
) -> None:
    """The 7 cycle radios and the 6 field-mask radios, written and read back.

    `sculpt_field_mask` is the interesting one: two of the six values are
    Python's `~(0x20|0x40)` and `~(0x40|0x80)`, i.e. NEGATIVE (-97, -193), and a
    client that normalised them to 8-bit would sculpt with a different set of
    terms.  The engine is asked what it stored.
    """
    saved = _settings(ws, SCULPT_SETTINGS)
    try:
        for value in (1, 3, 10, 33, 100, 333, 1000):
            ws.call("cmd.set", "sculpting_cycles", value, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", "sculpting_cycles") == value

        for value in (0x01, 0x03, 0x1F, ~(0x20 | 0x40), ~(0x40 | 0x80), 0xFF):
            ws.call("cmd.set", "sculpt_field_mask", value, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", "sculpt_field_mask") == value

        # The two checks are plain 0/1 booleans.
        for name in ("auto_sculpt", "sculpting"):
            ws.call("cmd.set", name, 1, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", name) == 1
            ws.call("cmd.set", name, 0, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", name) == 0
    finally:
        _restore(ws, saved)


def test_sculpt_activate_deactivate_and_purge_move_real_state(
    bridge: RunningBridge, ws: WSClient
) -> None:
    """`sculpt_activate all` / `sculpt_deactivate all` / `cmd.sculpt_purge`.

    MEASURED, not "did not raise". `cmd.sculpt_iterate` returns the STRAIN and
    is the cheapest observable of whether the `SculptMemory` exists at all; on a
    fresh alanine the numbers are

        before activate     0.0
        after  activate     4.4496…   (non-zero: the memory is there)
        after  deactivate   0.0

    so dropping the `sculpt_activate` line turns this test red — which the
    weaker `strain >= 0` version it replaced did not.
    """
    name = "p8a1_sculpt"
    saved = _settings(ws, SCULPT_SETTINGS)

    def strain(tag: str) -> float:
        lines = _tagged(bridge, ws, tag, "cmd.sculpt_iterate('%s', cycles=1)" % name)
        assert lines, "no answer from sculpt_iterate (%s)" % tag
        return float(lines[-1].split(None, 1)[1])

    try:
        ws.call("cmd.fragment", "ala", name)
        assert strain("P8A1SC0") == 0.0, "an unsculpted fragment already has strain"

        ws.do("sculpt_activate %s" % name)
        assert strain("P8A1SC1") > 0.0, "sculpt_activate allocated nothing"

        ws.do("sculpt_deactivate %s" % name)
        assert strain("P8A1SC2") == 0.0, "sculpt_deactivate left the memory in place"

        # Purge is the CALLABLE leaf (`('command', 'Clear Memory',
        # cmd.sculpt_purge)`), so it goes out as `{t:'call'}` from the client
        # and PyMOL echoes nothing.  MEASURED and worth recording: unlike
        # deactivate it does NOT make `sculpt_iterate` answer 0 — after
        # activate + purge the fragment still reported 9.91 — so "Clear Memory"
        # is not a synonym for "Deactivate".
        ws.do("sculpt_activate %s" % name)
        assert ws.call_reply("cmd.sculpt_purge")["t"] == "ok"
        assert strain("P8A1SC3") > 0.0
        ws.do("sculpt_deactivate %s" % name)
    finally:
        ws.call("cmd.delete", name)
        _restore(ws, saved)


def test_the_valence_and_charge_command_strings_change_the_model(
    bridge: RunningBridge, ws: WSClient
) -> None:
    """`alter pk1, formal_charge=±1/0`, `h_fill`, `remove pk1`, `cycle_valence`.

    Every one of these needs pk1, which is why the row could only ever be
    half-checked by a harvest.  `cmd.edit` sets it without a mouse click; the
    editor is put back afterwards because a stray pk1 turns the next test's
    left click into `pkat`.
    """
    name = "p8a1_charge"
    try:
        ws.call("cmd.fragment", "ala", name)
        ws.call("cmd.edit", "%s and name N" % name)

        for value in (1, -1, 0):
            ws.do("alter pk1, formal_charge=%d" % value)
            tag = "P8A1CHG%d" % (value + 1)
            ws.do("iterate pk1, print('%s', formal_charge)" % tag)
            lines = _echo_free(bridge.wait_for_feedback(tag, timeout=5.0), tag)
            assert lines, "no iterate output for formal_charge=%d" % value
            assert int(lines[-1].split()[1]) == value, lines

        # `h_fill` replaces the hydrogens on pk1: the atom count moves.
        before = ws.call("cmd.count_atoms", name)
        ws.do("h_fill")
        after = ws.call("cmd.count_atoms", name)
        assert after != before, "h_fill changed nothing (before=%d)" % before

        # `remove pk1` deletes the picked atom.
        ws.call("cmd.edit", "%s and name CB" % name)
        before = ws.call("cmd.count_atoms", name)
        ws.do("remove pk1")
        assert ws.call("cmd.count_atoms", name) == before - 1
    finally:
        ws.call("cmd.unpick")
        ws.call("cmd.edit_mode", 0)
        ws.call("cmd.delete", name)


def test_cycle_valence_moves_a_bond_order(bridge: RunningBridge, ws: WSClient) -> None:
    """`cycle_valence` is the one leaf whose effect is on a BOND, not an atom."""
    name = "p8a1_valence"
    try:
        # Two picks make a bond the editor can act on (pk1/pk2).
        ws.call("cmd.fragment", "ala", name)
        ws.call("cmd.edit", "%s and name C" % name, "%s and name O" % name)

        # `iterate_bonds` is NOT a command in this build (the parser falls
        # through to Python and raises SyntaxError, measured), so the bond
        # orders are read off the model — an attribute, hence a print.
        read = "[b.order for b in cmd.get_model('%s and name C+O').bond]" % name

        before = _tagged(bridge, ws, "P8A1BONDA", read)
        assert before, "no bond list before cycle_valence"

        ws.do("cycle_valence")

        after = _tagged(bridge, ws, "P8A1BONDB", read)
        assert after, "no bond list after cycle_valence"
        assert after[0].split(None, 1)[1] != before[0].split(None, 1)[1], (
            "cycle_valence left every bond order unchanged: %r" % (before + after)
        )
    finally:
        ws.call("cmd.unpick")
        ws.call("cmd.edit_mode", 0)
        ws.call("cmd.delete", name)


# --------------------------------------------------------------------------- #
# Row 68 — the nine Mouse ring commands
# --------------------------------------------------------------------------- #

CONFIG_MOUSE_RINGS = [
    "three_button_motions",
    "three_button_editing",
    "three_button_all_modes",
    "two_button_editing",
    "two_button",
]

MOUSE_RINGS = [
    "three_button_viewing",
    "three_button_lights",
    "one_button_viewing",
    "three_button_maestro",
]


def test_the_nine_ring_commands_each_change_the_live_button_mode(ws: WSClient) -> None:
    """Five `cmd.config_mouse(ring)` and four `cmd.mouse(action)`, MEASURED.

    Both halves are pinned to the exact `(button_mode_name, button_mode)` pair
    the engine reports, because a weaker assertion does not distinguish them:
    an earlier version of this test only checked "the names are not all equal"
    and PASSED with all four `cmd.mouse` calls replaced by one
    `config_mouse('three_button_viewing')`.

    The pairs are measurements, not guesses, and they show the two commands are
    genuinely different mechanisms:

      * `config_mouse` installs a RING and leaves `button_mode` at 0, the index
        into it — so `three_button_all_modes` displays "3-Button Editing",
        the first mode of that ring, and two menu entries land on one name.
      * `cmd.mouse(mode)` selects a mode OUTSIDE the ring and stores
        `-1 - mode_name_list.index(mode)` (`controlling.py:667-671`), i.e. -2,
        -1, -10, -5 — always negative.

    Restoring the ring matters more than usual: it decides what every later
    drag test's buttons DO.
    """
    before = (ws.call("cmd.get", "button_mode_name"), ws.call("cmd.get_setting_int", "button_mode"))
    try:
        for ring, name in [
            ("three_button_motions", "3-Button Motions"),
            ("three_button_editing", "3-Button Editing"),
            ("three_button_all_modes", "3-Button Editing"),
            ("two_button_editing", "2-Button Editing"),
            ("two_button", "2-Button Viewing"),
        ]:
            assert ws.call_reply("cmd.config_mouse", ring)["t"] == "ok", ring
            assert ws.call("cmd.get", "button_mode_name") == name, ring
            assert ws.call("cmd.get_setting_int", "button_mode") == 0, ring

        for ring, name, mode in [
            ("three_button_viewing", "3-Button Viewing", -2),
            ("three_button_lights", "3-Button Lights", -1),
            ("one_button_viewing", "1-Button Viewing", -10),
            ("three_button_maestro", "3-Button Maestro", -5),
        ]:
            assert ws.call_reply("cmd.mouse", ring)["t"] == "ok", ring
            assert ws.call("cmd.get", "button_mode_name") == name, ring
            assert ws.call("cmd.get_setting_int", "button_mode") == mode, ring
    finally:
        # The process default, measured: ('3-Button Viewing', 0).
        ws.call("cmd.config_mouse", "three_button_viewing")
        restored = (
            ws.call("cmd.get", "button_mode_name"),
            ws.call("cmd.get_setting_int", "button_mode"),
        )
        assert restored == ("3-Button Viewing", 0), (restored, before)


def test_the_three_mouse_checks_are_real_settings(ws: WSClient) -> None:
    """`virtual_trackball`, `mouse_grid`, `roving_origin` — written and read."""
    names = ["virtual_trackball", "mouse_grid", "roving_origin"]
    saved = _settings(ws, names)
    try:
        for name in names:
            ws.call("cmd.set", name, 1, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", name) == 1, name
            ws.call("cmd.set", name, 0, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", name) == 0, name
    finally:
        _restore(ws, saved)


def test_mouse_selection_mode_takes_all_seven_values(ws: WSClient) -> None:
    saved = _settings(ws, ["mouse_selection_mode"])
    try:
        for value in range(7):
            ws.call("cmd.set", "mouse_selection_mode", value, log=1, quiet=0)
            assert ws.call("cmd.get_setting_int", "mouse_selection_mode") == value
    finally:
        _restore(ws, saved)


# --------------------------------------------------------------------------- #
# Row 67 — PgUp / PgDn really recall scenes
# --------------------------------------------------------------------------- #

PGUP = 104
PGDN = 105
KEY_STATE_SPECIAL = -2


def test_pgup_and_pgdn_pressed_as_KEYS_step_the_scene_bin(ws: WSClient) -> None:
    """`Scene > Next [PgDn]` / `Previous [PgUp]` are not menu items only.

    PyMOL binds them itself (`modules/pymol/shortcut_dict.py`: `'pgup':
    ('scene action=previous', …)`, `'pgdn': ('scene action=next', …)`) and the
    browser forwards them as GLUT SPECIAL codes 104/105 with state -2
    (`modules/pymol/internal.py:418`, `KeyboardService.tsx`).  This drives the
    whole path — key frame, `OrthoSpecial`, `cmd.key_mappings` — instead of
    asserting the label says `[PgUp]`.

    The scene bin and the camera are global, so both are snapshotted.
    """
    existing = list(ws.call("cmd.get_scene_list") or [])
    view = ws.call("cmd.get_view")
    made = ["p8a1_s1", "p8a1_s2", "p8a1_s3"]
    obj = "p8a1_scene_obj"
    try:
        ws.call("cmd.fragment", "ala", obj)
        for scene in made:
            ws.call("cmd.scene", scene, "store", quiet=1)
        assert [s for s in ws.call("cmd.get_scene_list") if s in made] == made

        ws.call("cmd.scene", made[0], "recall", animate=0)
        assert ws.call("cmd.get", "scene_current_name") == made[0]

        def press(code: int) -> None:
            ws.input(
                "button", button=code, state=KEY_STATE_SPECIAL, x=0, y=0, mod=0, when=0.0
            )

        def wait_for_scene(expected: str) -> str:
            # Input is queued and applied by a DRAW, so this polls.
            for _ in range(60):
                current = ws.call("cmd.get", "scene_current_name")
                if current == expected:
                    return current
                time.sleep(0.05)
            return ws.call("cmd.get", "scene_current_name")

        press(PGDN)
        assert wait_for_scene(made[1]) == made[1], "PgDn did not advance the scene"

        press(PGUP)
        assert wait_for_scene(made[0]) == made[0], "PgUp did not step back"
    finally:
        for scene in made:
            ws.call("cmd.scene", scene, "clear")
        ws.call("cmd.delete", obj)
        ws.call("cmd.set_view", view)
        assert [s for s in (ws.call("cmd.get_scene_list") or []) if s in made] == []
        assert list(ws.call("cmd.get_scene_list") or []) == existing


# --------------------------------------------------------------------------- #
# Row 58 — the progress bar and Abort under a long ray
# --------------------------------------------------------------------------- #


def test_get_progress_is_negative_while_idle(ws: WSClient) -> None:
    """The show/hide predicate: Qt hides the row unless
    `int(cmd.get_progress()*100) >= 0` (`pymol_qt_gui.py:931-939`)."""
    value = ws.call("cmd.get_progress")
    assert isinstance(value, float)
    assert value < 0.0, value


def test_a_long_ray_drives_get_progress_and_interrupt_stops_it(
    ws: WSClient,
) -> None:
    """The quick-button progress row, exercised for the first time.

    `ray … async=1` renders on its own thread, so `cmd.get_progress()` is
    readable WHILE it runs — which is the only reason a progress bar is
    possible at all.  `cmd.interrupt` (`modules/pymol/locking.py:88`, "asynch,
    no locking") is what the red Abort button sends, and it has to land while
    the engine thread is inside that C++ call.
    """
    saved = _settings(ws, ["max_threads", "ray_shadows"])
    obj = "p8a1_ray"
    try:
        # THE SCENE HAS TO BE HEAVY ENOUGH TO CATCH. Measured while writing
        # this: an alanine in spheres rays 1600x1200 in 0.04 s and
        # `get_progress` is -1.0 for all 82,015 samples taken in 15 s — not
        # because progress is broken but because the task is over before the
        # first sample. A real protein surface with shadows at 900x700 takes
        # 0.75 s synchronously, and the async form reports 0.35 after 0.16 s.
        ws.call("cmd.set", "max_threads", 1, quiet=1)
        ws.call("cmd.set", "ray_shadows", 1, quiet=1)
        ws.call("cmd.delete", obj)
        ws.call("cmd.load", IL2, obj)
        ws.call("cmd.hide", "everything", obj)
        ws.call("cmd.show", "surface", obj)
        ws.do("ray 900, 700, async=1")

        samples = []
        deadline = time.monotonic() + 20.0
        while time.monotonic() < deadline:
            value = ws.call("cmd.get_progress")
            samples.append(value)
            if value >= 0.0:
                break

        positive = [s for s in samples if s >= 0.0]
        assert positive, (
            "cmd.get_progress never reported a running task during an async ray; "
            "%d samples, max=%r" % (len(samples), max(samples))
        )
        assert 0.0 <= positive[0] <= 1.0, positive

        # Abort. The task must go away, i.e. the predicate must fall back below
        # zero, or the bar would be stuck on screen for ever.
        ws.call("interrupt")
        deadline = time.monotonic() + 20.0
        while time.monotonic() < deadline:
            if ws.call("cmd.get_progress") < 0.0:
                break
            time.sleep(0.05)
        assert ws.call("cmd.get_progress") < 0.0, "the ray never finished after interrupt"
    finally:
        ws.call("cmd.delete", obj)
        _restore(ws, saved)


def test_the_progress_value_is_pushed_to_the_client(bridge: RunningBridge) -> None:
    """The client does not poll `get_progress`: the bridge's 10 Hz status
    thread carries it, which is why `QuickButtons` reads it off the connection
    store.  This asserts the field exists on the status payload at all."""
    status = bridge.pump.status_poller.status()
    assert "progress" in status, sorted(status)
    assert isinstance(status["progress"], float)


# --------------------------------------------------------------------------- #
# Row 55 — Tab from OUTSIDE the command line reaches PyMOL's own prompt
# --------------------------------------------------------------------------- #

KEY_STATE_ASCII = -1
TAB = 9
BACKSPACE = 8


def _press(ws: WSClient, code: int, mod: int = 0) -> None:
    ws.input("button", button=code, state=KEY_STATE_ASCII, x=0, y=0, mod=mod, when=0.0)


def test_tab_pressed_outside_the_command_line_completes_pymols_own_prompt(
    bridge: RunningBridge, ws: WSClient
) -> None:
    """Qt's `eventFilter` routes a Tab KeyPress from the GL WIDGET into
    `pymol.button` (`pymol_qt_gui.py:440-455` -> `:50-54`), where `OrthoKey`
    case 9 runs `PComplete` on PyMOL's INTERNAL prompt
    (`layer1/Ortho.cpp:943-960`) — a different completion from the dock command
    line's, on a different line buffer.

    The client's equivalent is `KeyboardService`'s document-level forward, which
    skips text entries, so Tab typed anywhere but the command line arrives here
    as ASCII 9.  This drives that whole path and reads PyMOL's answer off the
    console: two characters, then Tab, then the candidate list PyMOL prints.
    """
    before = len(bridge.feedback_lines())
    try:
        for char in "lo":
            _press(ws, ord(char))
        _press(ws, TAB)

        deadline = time.monotonic() + 5.0
        lines: List[str] = []
        while time.monotonic() < deadline:
            lines = bridge.feedback_lines()[before:]
            if any("matching commands" in line for line in lines):
                break
            time.sleep(0.05)

        assert any("matching commands" in line for line in lines), (
            "Tab did not reach OrthoKey's completion; console said %r" % lines[-6:]
        )
        # The real candidates for 'lo' in this build, printed by PComplete.
        text = "\n".join(lines)
        for candidate in ("load", "load_traj", "log_open"):
            assert candidate in text, (candidate, lines[-6:])
    finally:
        # Leave PyMOL's internal line empty: backspace stops at the prompt
        # (`I->CurChar > I->PromptChar`), so over-sending is safe.
        for _ in range(24):
            _press(ws, BACKSPACE)
