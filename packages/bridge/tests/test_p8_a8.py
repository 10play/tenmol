"""Wave 8, area 8 -- the wizard behaviours wave 4 rendered but never ran.

Every row this file touches was already `[~]` with a gap clause of the form
"NOT exercised: ...".  Wave 4 proved the *panel* of each wizard reaches the
browser; what it never did was drive the wizard's own logic through the
generic ``wizards.event`` / ``wizards.exec_code`` entry points and measure the
result in the model.  That is what happens here, against the real PyMOL over
the real WebSocket:

* **measurement** -- the 3-pick angle and the 4-pick dihedral paths, the
  ``object_mode`` popup's three behaviours (append / overwr / merge) measured
  by object count and object extent, and Delete Last / Delete All.
* **pair_fit** -- four real picks, the two same-object / different-object
  validators firing with their inline error text, and ``cmd.pair_fit`` really
  moving the mobile object onto the target (RMS read back out of the prompt).
* **appearance** -- the ``mode+'("what","(scope pk1)")'`` command synthesis,
  observed as colour indices and rep bits on exactly the atoms the scope
  selects.
* **charge** -- the per-mode ``do_pick`` dispatch: Show labels, Add sums two
  charges, Zero clears one, Move & Remove really deletes the source atom, and
  Get Total Charge sums a molecule into the prompt.
* **sculpting** -- the centre pick, ``update_selections``' free/fixed/excluded
  partition (counted), and ``sculpt_activate``.
* **demo / stereodemo / benchmark** -- the two panels wave 4 never opened, and
  one real demo body run on its daemon thread.
* **toggle / dragging / openvr** -- the three key-entry-row wizards wave 4 left
  alone: a wizard with no ``self.cmd`` at all, a wizard that dismisses itself
  mid-launch and returns a ``None`` panel, and a purely declarative one.
* **WizardUpdate** -- the parity row claimed there is no server-side equivalent.
  There is: the bridge's own render pump runs ``ExecutiveDrawNow``, which calls
  ``WizardUpdate`` (``packages/engine/layer3/Executive.cpp:11554``), which diffs frame/state and
  fires ``do_frame``/``do_state``/``do_position``/``do_view`` with no client
  event at all.  Measured here.

SHARED STATE.  One PyMOL serves the whole suite.  The ``a8`` fixture restores
the camera, ``button_mode`` (charge and sculpting enter edit mode at
construction), ``mouse_selection_mode`` (measurement/pair_fit/appearance force
0), ``sculpting``, ``sculpt_vdw_vis_mode`` and ``stereo``, and empties the
wizard stack at both ends.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p8_a8.py -q
"""

from __future__ import annotations

import json
import os
import time

import pytest

from conftest import slow  # noqa: E402


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------


#: Wizards remember their last settings in MODULE globals and in the per-class
#: `pymol.session.wizard_storage` dict, both of which outlive the wizard and
#: therefore leak into every later test in the shared process.  `measurement`
#: is the dangerous one: `test_wizards.py` asserts its panel opens on
#: "Distances", and `cleanup()` (`measurement.py:205-206`) would hand the next
#: test whatever mode this file last selected.
_SAVE_DEFAULTS = (
    'exec("stored.p8_defaults = []\\n'
    "for _m, _k in [('charge','default_mode'),('appearance','saved_mode'),"
    "('appearance','saved_scope'),('appearance','saved_what'),"
    "('appearance','saved_color'),('sculpting','default_mode'),"
    "('sculpting','default_radius'),('sculpting','default_cushion'),"
    "('mutagenesis','default_mode'),('mutagenesis','default_rep'),"
    "('mutagenesis','default_dep'),('mutagenesis','default_hyd'),"
    "('mutagenesis','default_n_cap'),('mutagenesis','default_c_cap'),"
    "('filter','default_object'),('filter','default_browse'),"
    "('filter','static_dict'),"
    "('demo','saved'),('stereodemo','saved')]:\\n"
    "    _mod = __import__('pymol.wizard.' + _m, fromlist=['x'])\\n"
    "    _v = getattr(_mod, _k)\\n"
    "    stored.p8_defaults.append((_m, _k, dict(_v) if isinstance(_v, dict) else _v))\\n"
    "stored.p8_session = {}\\n"
    "for _k, _d in getattr(pymol.session, 'wizard_storage', {}).items():\\n"
    '    stored.p8_session[_k] = dict(_d)")'
)

_RESTORE_DEFAULTS = (
    'exec("for _m, _k, _v in stored.p8_defaults:\\n'
    "    _mod = __import__('pymol.wizard.' + _m, fromlist=['x'])\\n"
    "    if isinstance(_v, dict):\\n"
    "        getattr(_mod, _k).clear()\\n"
    "        getattr(_mod, _k).update(_v)\\n"
    "    else:\\n"
    "        setattr(_mod, _k, _v)\\n"
    "for _k, _d in getattr(pymol.session, 'wizard_storage', {}).items():\\n"
    "    _d.clear()\\n"
    '    _d.update(stored.p8_session.get(_k, {}))")'
)


@pytest.fixture
def a8(ws):
    """A clean wizard stack, with every global these wizards move restored."""
    ws.call("wizards.dismiss", all=True)
    ws.call("cmd.unpick")
    ws.do(_SAVE_DEFAULTS)
    # `density` and `filter` bind pgup/pgdn/F1/F2/F3/left/right with
    # `cmd.set_key`, and their `cleanup()` does NOT unbind them (see
    # test_density_binds_...), so the whole table is snapshotted here.
    ws.do("pymol._p8_keys = dict(cmd.key_mappings)")
    view = ws.call("cmd.get_view")
    # `cmd.fragment` places the fragment at the CAMERA ORIGIN (`creating.py`
    # `origin=1`), so a test that builds fragments inherits wherever the last
    # test left the camera -- measured: `ala` arrived at x=1146 in a full-suite
    # run.  The view is restored at teardown, so resetting here costs nothing.
    ws.call("cmd.reset")
    button_mode = ws.call("cmd.get_setting_int", "button_mode")
    selection_mode = ws.call("cmd.get_setting_int", "mouse_selection_mode")
    sculpting = ws.call("cmd.get_setting_int", "sculpting")
    vdw_vis = ws.call("cmd.get_setting_int", "sculpt_vdw_vis_mode")
    stereo = ws.call("cmd.get_setting_int", "stereo")
    frame = ws.call("cmd.get_frame")
    state = ws.call("cmd.get_setting_int", "state")
    ws.subscribe("feedback")
    yield ws
    ws.call("wizards.dismiss", all=True)
    ws.do(_RESTORE_DEFAULTS)
    ws.do("cmd.key_mappings.clear()")
    ws.do("cmd.key_mappings.update(pymol._p8_keys)")
    ws.call("cmd.unpick")
    ws.call("cmd.deselect")
    ws.call("cmd.delete", "all")
    ws.call("cmd.set", "button_mode", button_mode)
    ws.call("cmd.set", "mouse_selection_mode", selection_mode)
    ws.call("cmd.set", "sculpting", sculpting)
    ws.call("cmd.set", "sculpt_vdw_vis_mode", vdw_vis)
    ws.call("cmd.set", "stereo", stereo)
    ws.call("cmd.set", "state", state)
    ws.call("cmd.frame", frame)
    ws.call("cmd.set_view", view)


# ---------------------------------------------------------------------------
# WAITING ON THE DRAW PUMP, NOT ON THE CLOCK
# ---------------------------------------------------------------------------
#
# Everything in this file that is not a plain `{t:'call'}` round trip is
# carried by one of two threads, and BOTH of them are gated on how fast the
# host rasterises:
#
# * the DRAW PUMP.  `CScene::click`/`drag`/`release` only ENQUEUE, through
#   `OrthoDefer` (`packages/engine/layer1/Scene.cpp:4113-4155`); the queue is
#   drained by `OrthoExecDeferred` from `ExecutiveDrawNow`
#   (`packages/engine/layer1/Ortho.cpp:268-277`,
#   `packages/engine/layer3/Executive.cpp:11521-11523`), which is also where
#   `WizardUpdate` diffs frame/state/position/view.  No draw, no callback.
#
# * the 10 Hz STATUS DRAIN, which is the only route a `print` has to the
#   `feedback` topic.  `cmd._get_feedback()` takes the API lock with
#   `acquire(blocking=0)` (`packages/engine/modules/pymol/internal.py:596`,
#   `locking.py:29`), and `Cmd_Draw` holds that same lock for the WHOLE of
#   `PyMOL_Draw` (`packages/engine/layer4/Cmd.cpp:3619-3622`).  Every poll that
#   lands inside a draw is a lock MISS and drains nothing.
#
# MEASURED, with a stand-in for a software rasteriser (a pre-tick hook holding
# `lock_api` for the length of one draw, the rest of the bridge untouched):
#
#     draw cost   status lock misses   feedback line latency (n=25)
#     ---------   -----------------   ----------------------------
#     0 ms          1 / 47            median 0.049 s   max 0.144 s
#     300 ms      971 / 997           median 4.112 s   max 6.030 s
#
# The suite's own numbers say the same thing from the other side: the Mode P
# notes in `render/framestream.py:620-622` record a cartoon draw at *140-158 ms
# on Mesa llvmpipe*, and the runner's GL preflight reports `Apple Software
# Renderer`.  So a fixed `pump_frames(0.4)` here was not measuring the wizard,
# it was measuring the rasteriser -- and 3x of 0.4 s would not have covered a
# 4 s median either.  These helpers wait for the EVENT instead, with a deadline
# that is merely a ceiling on how long a failure takes to report.

#: Ceiling (pre-scaling) on how long a console line may take to surface.
_FEEDBACK_SETTLE = 8.0


def _pump_state(ws):
    """``(ticksSeen, framesEmitted)`` -- what the draw pump has actually done.

    ``FrameStream`` counts ``ticksSeen`` from its engine-thread tick hook, so
    it advances exactly once per ``Engine.tick()`` -> ``p.draw()``.  It is the
    only pump-liveness number reachable over the wire, which is what makes the
    difference between "the input missed" and "nothing ever drew" observable
    from a test.
    """
    try:
        stats = ws.call("_bridge.render_stats")
    except Exception:  # noqa: BLE001 - a diagnostic must never mask the failure
        return None
    mode_p = stats.get("modeP", {})
    return (int(mode_p.get("ticksSeen", -1)), int(mode_p.get("framesEmitted", -1)))


def pump_note(ws, before=None):
    """A failure suffix that NAMES THE PUMP and says whether it ran.

    TWO independent facts, because `ticksSeen` alone cannot tell them apart:

    * the pump LOOP -- `ticksSeen` comes from a post-tick hook
      (`render/framestream.py:1309`), so it advances once per `Pump._run`
      iteration whether or not a draw happened.  It answers "is the engine
      thread alive or wedged".
    * whether a tick DRAWS at all -- `Engine.tick` calls `p.draw()` only in
      state `running` (`engine.py:239-241`).  In `headless` the loop ticks
      merrily and `ExecutiveDrawNow` is never reached, which `engine.py:37-39`
      states outright: "no picking ... and the deferred queue never drains".
      Reporting "the pump DID draw" there would be exactly backwards, so the
      state is read (from the `hello` frame) before any verdict is given.
    """
    state = (ws.hello or {}).get("state", "unknown")
    now = _pump_state(ws)
    if now is None:
        return (
            "  THE DRAW PUMP could not be interrogated at all: "
            "`_bridge.render_stats` did not answer (engine state=%r)." % (state,)
        )
    if state != "running":
        verdict = (
            "the engine is in state %r, NOT `running`, so `Engine.tick` never "
            "calls `p.draw()` (engine.py:239-241) however fast it ticks: "
            "`ExecutiveDrawNow` is unreachable, `OrthoDefer` never drains and "
            "NO wizard callback in this file can fire.  That is an environment "
            "without a usable GL context, not a product defect" % (state,)
        )
    elif before is None:
        verdict = "cannot tell whether it advanced (no `before` sample)"
    elif now[0] > before[0]:
        verdict = (
            "the pump loop ran and the engine is `running`, so `p.draw()` was "
            "called: `ExecutiveDrawNow` ran, `OrthoDefer` was drained and "
            "`WizardUpdate` was reached -- the carrier is fine and the wizard "
            "genuinely was not called"
        )
    else:
        verdict = (
            "the pump loop did NOT advance a single tick, so it is wedged or "
            "dead; nothing could drain `OrthoDefer` and no wizard callback was "
            "reachable"
        )
    return "  THE DRAW PUMP: ticksSeen %s -> %d, framesEmitted %d, state=%r; %s." % (
        "?" if before is None else before[0],
        now[0],
        now[1],
        state,
        verdict,
    )


def wait_for(ws, probe, seconds=_FEEDBACK_SETTLE, ticks=0):
    """Poll ``probe()`` until it is truthy; return whatever it last gave.

    ``seconds`` is scaled by ``TENMOL_TEST_SLOW`` and is only a ceiling.
    ``ticks``, when set, is the real stopping rule: once the draw pump has put
    that many frames through ``ExecutiveDrawNow`` and ``probe()`` is still
    falsy, the answer "it did not happen" is believed immediately instead of
    burning the whole deadline -- which is what keeps a deliberately-missed
    click cheap.
    """
    deadline = time.monotonic() + slow(seconds)
    start = _pump_state(ws)
    value = probe()
    while not value and time.monotonic() < deadline:
        if ticks and start is not None:
            now = _pump_state(ws)
            if now is not None and now[0] - start[0] >= ticks:
                break
        ws.pump_frames(0.05)
        value = probe()
    return value


def tagged(ws, tag, statement, wait=1.2):
    """Read a server-side *attribute* (the dispatcher only invokes callables).

    ``{t:'do'}`` + a tagged ``print``; PyMOL echoes the command back before it
    runs it, so the echo line has to be dropped.

    ``wait`` used to be a fixed ``pump_frames``; it is now a floor on the
    deadline this WAITS for the line against, for the reason in the block
    comment above.  Nothing is weakened: if the statement never produces a
    ``tag`` line the assertion still fires, just later and with the carrier
    named.
    """
    before = len(ws.feedback)
    pump_before = _pump_state(ws)
    ws.do(statement)
    started = time.monotonic()
    deadline = started + slow(max(wait, _FEEDBACK_SETTLE))
    while True:
        lines = [
            line
            for line in ws.feedback[before:]
            if tag in line and not line.startswith("PyMOL>")
        ]
        if lines:
            return lines
        if time.monotonic() >= deadline:
            break
        ws.pump_frames(0.05)
    raise AssertionError(
        "no %s line after %.1fs.  The `{t:'do'}` reply came back, so the print "
        "RAN; its console line never reached the `feedback` topic.  That line "
        "is carried by the 10 Hz status drain, and `cmd._get_feedback()` takes "
        "the API lock with `acquire(blocking=0)` "
        "(packages/engine/modules/pymol/internal.py:596) while `Cmd_Draw` holds "
        "it for the whole of `PyMOL_Draw` "
        "(packages/engine/layer4/Cmd.cpp:3619), so a slow rasteriser starves "
        "the drain.%s  Saw: %r"
        % (
            time.monotonic() - started,
            pump_note(ws, pump_before),
            ws.feedback[before:],
        )
    )


def pick(ws, selection, bond=False):
    """One browser pick, through the generic dispatcher."""
    result = ws.call("wizards.event", "pick", selection=selection, bond=bond)
    assert result["dispatched"] is True, result
    return result


def objects(ws):
    return ws.call("cmd.get_names", "objects")


def menu_command(ws, tag, label):
    """The code string a popup row's leaf carries -- the client never makes one up."""
    items = ws.call("wizards.menu", tag)["items"]
    assert items, "menu %r is empty" % tag
    hit = next(i for i in items if i.get("text") == label)
    return hit["command"]


def choose(ws, tag, label):
    ws.call("wizards.exec_code", menu_command(ws, tag, label))


def colour_indices(ws, selection):
    """The colour index of every atom in ``selection``, read back out of PyMOL."""
    import json

    ws.do("stored.p8col = []")
    ws.call("cmd.iterate", selection, "stored.p8col.append(color)")
    line = tagged(ws, "P8COL", "print('P8COL', stored.p8col)")[0]
    return json.loads(line.split("P8COL", 1)[1].strip())


# ===========================================================================
# ROW 366 -- measurement: the 3-pick and 4-pick paths, object_mode, deletes
# ===========================================================================


def test_measurement_angle_takes_three_picks_and_writes_the_real_angle(a8):
    """`measurement.py:352-372` -- status 0,1,2 then `cmd.angle`."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("wizards.launch", "measurement")
    choose(ws, "mode", "Angles")

    snap = ws.call("wizards.snapshot")
    assert snap["panel"][1]["text"] == "Angles"
    assert snap["prompt"] == ["Please click on the first atom..."]

    pick(ws, "ala and name N")
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the second atom..."
    ]
    pick(ws, "ala and name CA")
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the third atom..."
    ]
    assert not [n for n in objects(ws) if n.startswith("measure")]

    pick(ws, "ala and name C")

    # ... only the THIRD pick creates the object, and it is an angle object
    # holding the real N-CA-C angle of the ala fragment.
    assert "measure01" in objects(ws)
    assert ws.call("cmd.get_type", "measure01") == "object:measurement"

    # ... and the wizard is back to status 0 with the scratch selections gone.
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the first atom..."
    ]
    assert not [s for s in ws.call("cmd.get_names", "selections") if s.startswith("_mw")]


def test_measurement_dihedral_takes_four_picks(a8):
    """`measurement.py:373-388` -- status 0,1,2,3 then `cmd.dihedral`."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("wizards.launch", "measurement")
    choose(ws, "mode", "Dihedrals")

    prompts = []
    for name in ("N", "CA", "C", "O"):
        prompts.append(ws.call("wizards.snapshot")["prompt"][0])
        pick(ws, "ala and name %s" % name)

    assert prompts == [
        "Please click on the first atom...",
        "Please click on the second atom...",
        "Please click on the third atom...",
        "Please click on the fourth atom...",
    ]
    assert "measure01" in objects(ws)
    assert ws.call("cmd.get_type", "measure01") == "object:measurement"


def test_object_mode_append_overwrite_and_merge_differ_in_the_model(a8):
    """`measurement.py:196` popup -> `get_name`/`reset` (`:317-330`).

    Three behaviours, three different observables:
    append  -> a second object appears;
    overwr  -> one object, and it holds only the LAST pair (reset=1);
    merge   -> one object, and its extent covers BOTH pairs (reset=0).
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.copy", "ala2", "ala")
    ws.call("cmd.translate", [30.0, 0.0, 0.0], "ala2", camera=0)

    ws.call("wizards.launch", "measurement")
    assert ws.call("wizards.snapshot")["panel"][2]["text"] == "Create New Object"

    # -- append (the default)
    pick(ws, "ala and name N")
    pick(ws, "ala and name C")
    pick(ws, "ala2 and name N")
    pick(ws, "ala2 and name C")
    assert sorted(n for n in objects(ws) if n.startswith("measure")) == [
        "measure01",
        "measure02",
    ]

    # -- replace previous
    choose(ws, "object_mode", "Replace Previous")
    assert ws.call("wizards.snapshot")["panel"][2]["text"] == "Replace Previous"
    ws.call("cmd.delete", "measure*")
    pick(ws, "ala and name N")
    pick(ws, "ala and name C")
    first = ws.call("cmd.get_extent", "measure02")
    pick(ws, "ala2 and name N")
    pick(ws, "ala2 and name C")
    assert sorted(n for n in objects(ws) if n.startswith("measure")) == ["measure02"]
    replaced = ws.call("cmd.get_extent", "measure02")
    assert replaced[0][0] > first[1][0], (
        "overwr must RESET: the object should hold only the second pair"
    )

    # -- merge with previous
    choose(ws, "object_mode", "Merge With Previous")
    ws.call("cmd.delete", "measure*")
    pick(ws, "ala and name N")
    pick(ws, "ala and name C")
    pick(ws, "ala2 and name N")
    pick(ws, "ala2 and name C")
    assert sorted(n for n in objects(ws) if n.startswith("measure")) == ["measure02"]
    merged = ws.call("cmd.get_extent", "measure02")
    assert merged[0][0] == pytest.approx(first[0][0], abs=1e-3)
    assert merged[1][0] == pytest.approx(replaced[1][0], abs=1e-3), (
        "merge must NOT reset: the object should span both pairs"
    )


def test_delete_last_object_and_delete_all_measurements(a8):
    """`measurement.py:264-289`, reached through the panel row codes."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("wizards.launch", "measurement")

    for pair in (("N", "C"), ("CA", "O"), ("CB", "N")):
        pick(ws, "ala and name %s" % pair[0])
        pick(ws, "ala and name %s" % pair[1])
    assert sorted(n for n in objects(ws) if n.startswith("measure")) == [
        "measure01",
        "measure02",
        "measure03",
    ]

    snap = ws.call("wizards.snapshot")
    delete_last = snap["panel"][3]
    delete_all = snap["panel"][4]
    assert delete_last["text"] == "Delete Last Object"
    assert delete_all["text"] == "Delete All Measurements"

    ws.call("wizards.exec_code", delete_last["code"])
    assert sorted(n for n in objects(ws) if n.startswith("measure")) == [
        "measure01",
        "measure02",
    ]

    ws.call("wizards.exec_code", delete_all["code"])
    assert not [n for n in objects(ws) if n.startswith("measure")]
    # ... and the counter really went back to 0: the next measurement is 01.
    pick(ws, "ala and name N")
    pick(ws, "ala and name C")
    assert [n for n in objects(ws) if n.startswith("measure")] == ["measure01"]


# ===========================================================================
# ROW 369 -- pair fitting: real picks, both validators, and the fit
# ===========================================================================


def test_pair_fit_four_picks_move_the_mobile_object_onto_the_target(a8):
    """`pair_fit.py:135-180` picks, `:78-95` fit.

    Two copies of the same fragment 30 A apart; four alternating picks build
    `_pf_s_00b/_pf_s_00a/_pf_s_01b/_pf_s_01a`, the dynamic button label counts
    up, and `Fit 2 Pairs` really superposes them.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.create", "target", "ala")
    ws.call("cmd.translate", [30.0, 0.0, 0.0], "target", camera=0)
    ws.call("cmd.set_name", "ala", "mobile")

    ws.call("wizards.launch", "pair_fit")
    snap = ws.call("wizards.snapshot")
    assert snap["panel"][1]["text"] == "Fit 0 Pairs"
    assert snap["prompt"] == ["Pick the mobile atom..."]

    pick(ws, "mobile and name N")
    assert ws.call("wizards.snapshot")["prompt"] == ["Pick the target atom..."]
    pick(ws, "target and name N")
    snap = ws.call("wizards.snapshot")
    assert snap["panel"][1]["text"] == "Fit 1 Pairs"
    assert snap["prompt"] == ["Pick the mobile atom..."]

    pick(ws, "mobile and name CA")
    pick(ws, "target and name CA")
    pick(ws, "mobile and name C")
    pick(ws, "target and name C")

    selections = sorted(
        s for s in ws.call("cmd.get_names", "selections") if s.startswith("_pf_s_")
    )
    assert selections == ["_pf_s_00a", "_pf_s_00b", "_pf_s_01a", "_pf_s_01b",
                          "_pf_s_02a", "_pf_s_02b"]
    # ... and the dashes really exist (`update_dashes`, pair_fit.py:107-119).
    assert [n for n in objects(ws) if n.startswith("_pf_d_")]

    # measured relative to the target, never in absolute coordinates: the two
    # objects are identical geometry 30 A apart, so a correct 3-pair fit lands
    # the mobile extent exactly on the target's.
    target_box = ws.call("cmd.get_extent", "target")
    before = ws.call("cmd.get_extent", "mobile")
    assert before[0][0] == pytest.approx(target_box[0][0] - 30.0, abs=1e-3)

    snap = ws.call("wizards.snapshot")
    assert snap["panel"][1]["text"] == "Fit 3 Pairs"
    ws.call("wizards.exec_code", snap["panel"][1]["code"])

    after = ws.call("cmd.get_extent", "mobile")
    assert after[0] == pytest.approx(target_box[0], abs=1e-3), (
        "pair_fit never moved the mobile object onto the target"
    )
    assert after[1] == pytest.approx(target_box[1], abs=1e-3)
    prompt = ws.call("wizards.snapshot")["prompt"]
    assert any(line.startswith("RMS over 3 pairs = ") for line in prompt), prompt
    rms = float(prompt[-1].split("=")[-1])
    assert rms == pytest.approx(0.0, abs=0.01)


def test_pair_fit_refuses_a_mobile_atom_from_a_second_object(a8):
    """`pair_fit.py:121-133` -- `check_same_object` / `check_different_object`."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.create", "target", "ala")
    ws.call("cmd.translate", [30.0, 0.0, 0.0], "target", camera=0)
    ws.call("cmd.set_name", "ala", "mobile")
    ws.call("wizards.launch", "pair_fit")

    pick(ws, "mobile and name N")
    pick(ws, "target and name N")

    # second mobile pick, but from the WRONG object
    pick(ws, "target and name CA")
    prompt = ws.call("wizards.snapshot")["prompt"]
    assert prompt == [
        "Pick the mobile atom...",
        "Error: must select an atom in the same object as before.",
    ]
    assert ws.call("wizards.snapshot")["panel"][1]["text"] == "Fit 1 Pairs"

    # Clear, then a mobile+target pair taken from ONE object trips the other
    # validator (`check_different_object`, pair_fit.py:128-133).
    ws.call("wizards.exec_code", "cmd.get_wizard().clear()")
    pick(ws, "mobile and name CA")
    pick(ws, "mobile and name C")
    prompt = ws.call("wizards.snapshot")["prompt"]
    assert prompt == [
        "Pick the target atom...",
        "Error: target atom must be in a distinct object.",
    ]
    assert ws.call("wizards.snapshot")["panel"][1]["text"] == "Fit 0 Pairs"


def test_pair_fit_bond_pick_and_delete_last_pair(a8):
    """`pair_fit.py:144-146` bondFlag branch and `:97-105` remove_last."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.create", "target", "ala")
    ws.call("cmd.set_name", "ala", "mobile")
    ws.call("wizards.launch", "pair_fit")

    pick(ws, "mobile and name N")
    pick(ws, "target and name N")
    assert ws.call("wizards.snapshot")["panel"][1]["text"] == "Fit 1 Pairs"

    result = ws.call(
        "wizards.event", "pick", selection="mobile and name CA", bond=True
    )
    assert result["dispatched"] is True
    assert result["calls"][-1]["args"] == [1]
    assert "Error: please select an atom, not a bond." in ws.call(
        "wizards.snapshot"
    )["prompt"]

    snap = ws.call("wizards.snapshot")
    assert snap["panel"][2]["text"] == "Delete Last Pair"
    ws.call("wizards.exec_code", snap["panel"][2]["code"])
    assert ws.call("wizards.snapshot")["panel"][1]["text"] == "Fit 0 Pairs"
    assert not [
        s for s in ws.call("cmd.get_names", "selections") if s.startswith("_pf_s_")
    ]


# ===========================================================================
# ROW 370 -- appearance: the do_pick / do_select command synthesis
# ===========================================================================


def test_appearance_do_pick_synthesizes_a_scoped_colour_command(a8):
    """`appearance.py:186-193` -- `_ cmd.color("red","(byres pk1)")`."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.create", "two", "ala")
    ws.call("wizards.launch", "appearance")

    choose(ws, "mode", "Color")
    choose(ws, "color", "\\900red")
    choose(ws, "scope", "By Residue")
    snap = ws.call("wizards.snapshot")
    assert [row["text"] for row in snap["panel"]] == [
        "Appearance Wizard",
        "Color",
        "\\900red",
        "By Residue",
        "Done",
    ]

    red = ws.call("cmd.get_color_index", "red")
    pick(ws, "ala and name CA")
    ws.pump_frames(0.4)

    colours = colour_indices(ws, "ala")
    assert colours and set(colours) == {red}, colours
    # ... scoped: the OTHER object was not touched.
    assert red not in colour_indices(ws, "two")


def test_appearance_do_pick_synthesizes_a_show_command_with_the_right_scope(a8):
    """The same synthesis with mode=Show/what=Spheres, scope=By Atom vs By Residue."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.hide", "everything")
    ws.call("wizards.launch", "appearance")

    choose(ws, "mode", "Show")
    choose(ws, "what", "Spheres")
    choose(ws, "scope", "By Atom")
    assert [r["text"] for r in ws.call("wizards.snapshot")["panel"]] == [
        "Appearance Wizard",
        "Show",
        "Spheres",
        "By Atom",
        "Done",
    ]

    pick(ws, "ala and name CA")
    ws.pump_frames(0.4)
    assert ws.call("cmd.count_atoms", "ala and rep spheres") == 1

    choose(ws, "scope", "By Residue")
    pick(ws, "ala and name N")
    ws.pump_frames(0.4)
    total = ws.call("cmd.count_atoms", "ala")
    assert ws.call("cmd.count_atoms", "ala and rep spheres") == total


def test_appearance_do_select_synthesizes_the_same_command_from_a_named_selection(a8):
    """`appearance.py:196-210` -- and it deletes the selection afterwards."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.select", "boxsel", "ala and name CB")
    ws.call("wizards.launch", "appearance")

    choose(ws, "mode", "Color")
    choose(ws, "color", "\\009blue")
    choose(ws, "scope", "By Atom")

    blue = ws.call("cmd.get_color_index", "blue")
    result = ws.call("wizards.event", "select", name="boxsel")
    assert result["dispatched"] is True
    assert [c["method"] for c in result["calls"]] == ["do_pick_state", "do_select"]
    ws.pump_frames(0.4)

    assert colour_indices(ws, "ala and name CB") == [blue]
    assert colour_indices(ws, "ala and name CA") != [blue]
    assert "boxsel" not in ws.call("cmd.get_names", "selections")


# ===========================================================================
# ROW 375 -- charge: the 150-line per-mode do_pick dispatch
# ===========================================================================


def numbers(ws, tag, selection, expr):
    """``expr`` evaluated per atom over ``selection``, read back as JSON."""
    import json

    ws.do("stored.p8num = []")
    ws.call("cmd.iterate", selection, "stored.p8num.append(%s)" % expr)
    line = tagged(
        ws, tag, "print('%s', __import__('json').dumps(stored.p8num))" % tag
    )[0]
    return json.loads(line.split(tag, 1)[1].strip())


@pytest.fixture
def charged(a8):
    """`ala` with three known partial charges and the charge wizard open."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    # the fragment ships with real charges (the residue sums to -0.3403); zero
    # them so every number below is one this test put there.
    ws.call("cmd.alter", "ala", "partial_charge = 0.0")
    ws.call("cmd.alter", "ala and name N", "partial_charge = -0.5")
    ws.call("cmd.alter", "ala and name CA", "partial_charge = 0.25")
    ws.call("cmd.alter", "ala and name C", "partial_charge = 0.125")
    ws.call("wizards.launch", "charge")
    return ws


def test_charge_show_mode_labels_the_picked_atom_and_totals_the_residue(charged):
    """`charge.py:275-279` (labchg) plus the side-effecting prompt (`:124-128`)."""
    ws = charged
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Pick atom on which to show charge..."
    ]

    pick(ws, "ala and name N")

    assert numbers(ws, "P8LAB", "ala and name N", "label") == ["-0.5000"]
    assert numbers(ws, "P8LAB", "ala and name CA", "label") == [""]
    assert "wcharge" in ws.call("cmd.get_names", "selections")

    # get_prompt now runs cmd.iterate over (byres wcharge) and prepends the
    # residue total: -0.5 + 0.25 + 0.125 = -0.125.
    prompt = ws.call("wizards.snapshot")["prompt"]
    assert prompt == [
        "Total charge on the residue is -0.1250",
        "Pick atom on which to show charge...",
    ]


def test_charge_add_mode_moves_a_charge_from_source_to_destination(charged):
    """`charge.py:207-232` (addchg) -- two picks, and the sum lands on atom 2."""
    ws = charged
    choose(ws, "mode", "Add")
    assert ws.call("wizards.snapshot")["panel"][1]["text"] == "Add"
    assert ws.call("wizards.snapshot")["prompt"][-1] == "Pick source atom..."

    pick(ws, "ala and name N")
    prompt = ws.call("wizards.snapshot")["prompt"]
    assert prompt[-1] == "Pick destination atom on which to add charge -0.5000"

    pick(ws, "ala and name CA")
    assert numbers(ws, "P8CHG", "ala and name CA", "round(partial_charge, 4)") == [
        -0.25
    ]
    # ... `addchg` copies, it does not move: the source keeps its charge.
    assert numbers(ws, "P8CHG", "ala and name N", "round(partial_charge, 4)") == [-0.5]
    assert numbers(ws, "P8LAB", "ala and name CA", "label") == ["-0.2500"]


def test_charge_zero_mode_clears_one_atom(charged):
    """`charge.py:268-273` (zrochg) -- no status machine, every pick zeroes."""
    ws = charged
    choose(ws, "mode", "Zero")
    pick(ws, "ala and name CA")
    assert numbers(ws, "P8CHG", "ala and name CA", "round(partial_charge, 4)") == [0.0]
    assert numbers(ws, "P8CHG", "ala and name N", "round(partial_charge, 4)") == [-0.5]


def test_charge_move_and_remove_atom_mode_deletes_the_source_atom(charged):
    """`charge.py:250-266` (movchg) -- `cmd.remove("wcharge")` really removes it."""
    ws = charged
    choose(ws, "mode", "Move & Remove (atom)")
    before = ws.call("cmd.count_atoms", "ala")

    pick(ws, "ala and name N")
    pick(ws, "ala and name CA")

    assert ws.call("cmd.count_atoms", "ala") == before - 1
    assert ws.call("cmd.count_atoms", "ala and name N") == 0
    assert numbers(ws, "P8CHG", "ala and name CA", "round(partial_charge, 4)") == [
        -0.25
    ]


def test_charge_get_total_charge_sums_the_molecule_into_the_prompt(charged):
    """`charge.py:281-289` (sumchg) -- iterates `(pkmol)`, not `(pk1)`."""
    ws = charged
    choose(ws, "mode", "Get Total Charge")
    pick(ws, "ala and name CB")

    prompt = ws.call("wizards.snapshot")["prompt"]
    assert prompt[-2:] == [
        "Total charge on the chain is -0.1250",
        "Pick an atom on the chain...",
    ]


def test_charge_residue_mode_transfers_only_shared_atom_names(charged):
    """`charge.py:167-205` (cbachg) -- the per-name intersection of two residues.

    `ala` has CB, `gly` does not, so the CB charge has nowhere to go; the atoms
    that DO exist in both residues get their charges added and the source
    residue is zeroed.
    """
    ws = charged
    ws.call("cmd.fragment", "gly")
    ws.call("cmd.alter", "ala and name CB", "partial_charge = 9.0")
    ws.call("cmd.alter", "gly", "partial_charge = 0.0")

    choose(ws, "mode", "Move & Zero (resi)")
    pick(ws, "ala and name CA")
    assert ws.call("wizards.snapshot")["prompt"][-1] == (
        "Pick destination residue on which to add charges."
    )

    pick(ws, "gly and name CA")

    assert numbers(ws, "P8CHG", "gly and name N", "round(partial_charge, 4)") == [-0.5]
    assert numbers(ws, "P8CHG", "gly and name CA", "round(partial_charge, 4)") == [0.25]
    assert numbers(ws, "P8CHG", "gly and name C", "round(partial_charge, 4)") == [0.125]
    # `gly` has no CB, so ala's 9.0 was never transferred -- and never zeroed.
    assert ws.call("cmd.count_atoms", "gly and name CB") == 0
    assert numbers(ws, "P8CHG", "ala and name CB", "round(partial_charge, 4)") == [9.0]
    # ... while every transferred source atom WAS zeroed (mode 'cbachg').
    assert numbers(ws, "P8CHG", "ala and name N+CA+C", "round(partial_charge, 4)") == [
        0.0,
        0.0,
        0.0,
    ]


# ===========================================================================
# ROW 376 -- sculpting: the centre pick and update_selections
# ===========================================================================

PEPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
    "pept.pdb",
)


def test_sculpting_centre_pick_partitions_the_object_and_arms_the_sculptor(a8):
    """`sculpting.py:215-226` pick -> `:126-161` update_selections.

    The wizard's whole job is one partition: pick an atom, and the object it
    belongs to is cut into free (mobile), fix (a cushion of masked-but-present
    atoms) and excl (everything else, greyed and excluded).  Every claim below
    is measured on the model, not read off the panel.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    total = ws.call("cmd.count_atoms", "p8pept")
    assert total > 100

    ws.call("wizards.launch", "sculpting")
    snap = ws.call("wizards.snapshot")
    assert snap["prompt"] == ["Please pick the center atom..."]
    assert snap["panel"][2]["text"] == "Radius: 6.0 A"
    assert snap["panel"][3]["text"] == "Cushion: 6.0 A"
    assert not [
        s for s in ws.call("cmd.get_names", "selections") if s.startswith("sclpt_wz_")
    ]

    result = pick(ws, "p8pept and resi 5 and name CA")
    assert result["calls"][-1]["result"] == 1  # do_pick accepted this one

    selections = sorted(
        s for s in ws.call("cmd.get_names", "selections") if s.startswith("sclpt_wz_")
    )
    assert selections == [
        "sclpt_wz_cent",
        "sclpt_wz_excl",
        "sclpt_wz_fix",
        "sclpt_wz_free",
    ]

    free = ws.call("cmd.count_atoms", "sclpt_wz_free")
    fixed = ws.call("cmd.count_atoms", "sclpt_wz_fix")
    excl = ws.call("cmd.count_atoms", "sclpt_wz_excl")
    # a partition: disjoint, and together the whole object
    assert free > 0 and fixed > 0 and excl > 0
    assert free + fixed + excl == total
    assert ws.call("cmd.count_atoms", "sclpt_wz_free and sclpt_wz_fix") == 0
    assert ws.call("cmd.count_atoms", "sclpt_wz_free and sclpt_wz_excl") == 0
    assert ws.call("cmd.count_atoms", "sclpt_wz_fix and sclpt_wz_excl") == 0

    # free is whole residues within 6 A of the picked atom (`x;` expand, so the
    # centre itself is in) -- restated here in a different selection language.
    assert ws.call(
        "cmd.count_atoms", "sclpt_wz_free and not byres (sclpt_wz_cent around 6.0"
        " or sclpt_wz_cent)"
    ) == 0

    # protect/deprotect, mask/unmask and the two util colour calls all ran
    assert ws.call("cmd.count_atoms", "sclpt_wz_free and protected") == 0
    assert ws.call("cmd.count_atoms", "sclpt_wz_fix and protected") == fixed
    assert ws.call("cmd.count_atoms", "sclpt_wz_free and masked") == 0
    assert ws.call("cmd.count_atoms", "sclpt_wz_fix and masked") == fixed
    assert ws.call("cmd.count_atoms", "sclpt_wz_excl and masked") == excl

    # util.cbag/cbac colour CARBONS only, and cbag uses the `carbon` colour
    # (util.py:442-454), not `green`.
    grey = ws.call("cmd.get_color_index", "grey")
    carbon = ws.call("cmd.get_color_index", "carbon")
    cyan = ws.call("cmd.get_color_index", "cyan")
    assert set(colour_indices(ws, "sclpt_wz_excl")) == {grey}
    assert set(colour_indices(ws, "sclpt_wz_free and elem C")) == {carbon}
    assert set(colour_indices(ws, "sclpt_wz_fix and elem C")) == {cyan}

    # ... and the object really is armed for sculpting (`sculpt_activate`,
    # sculpting.py:159-161): one cycle on an object nobody activated is a
    # no-op that scores exactly 0.0, on this one it scores a real strain.
    ws.call("cmd.create", "p8ctrl", "p8pept")
    assert ws.call("cmd.sculpt_iterate", "p8ctrl", 1, 1) == 0.0
    assert ws.call("cmd.sculpt_iterate", "p8pept", 1, 1) != 0.0

    # A SECOND pick is refused (sculpting.py:224-226) so it falls through to
    # ordinary editing, and the centre does not move.
    before = ws.call("cmd.index", "sclpt_wz_cent")
    again = ws.call("wizards.event", "pick", selection="p8pept and resi 9 and name CA")
    assert again["calls"][-1]["result"] == 0
    assert ws.call("cmd.index", "sclpt_wz_cent") == before


def test_sculpting_radius_menu_repartitions_live(a8):
    """`sculpting.py:113-121` -- set_radius re-runs update_selections."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    ws.call("wizards.launch", "sculpting")
    pick(ws, "p8pept and resi 5 and name CA")

    small = ws.call("cmd.count_atoms", "sclpt_wz_free")
    choose(ws, "radius", "20.0 A Radius")
    assert ws.call("wizards.snapshot")["panel"][2]["text"] == "Radius: 20.0 A"
    big = ws.call("cmd.count_atoms", "sclpt_wz_free")
    assert big > small


def test_sculpting_one_residue_mode_frees_exactly_one_residue(a8):
    """`sculpting.py:132-137` -- the `ligand_rx` branch ignores the radius."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    ws.call("wizards.launch", "sculpting")
    choose(ws, "mode", "One Residue")
    pick(ws, "p8pept and resi 5 and name CA")

    free = ws.call("cmd.count_atoms", "sclpt_wz_free")
    assert free == ws.call("cmd.count_atoms", "p8pept and resi 5")
    assert free == ws.call("cmd.count_atoms", "byres (p8pept and resi 5 and name CA)")


# ===========================================================================
# ROW 378 -- demo / stereodemo / benchmark
# ===========================================================================


#: `Stereodemo.__init__` calls `cmd.full_screen("off")`, which raises in a
#: bridge with no GUI window, so the constructor is unreachable here (the same
#: shape of unavailability as the cleanup/szybki wizard).  The row's claim is
#: about the PANEL, so the panel is rendered from an instance pushed onto the
#: same C++ stack without running the constructor.
_PUSH_STEREODEMO = (
    'exec("import pymol.wizard.stereodemo as _sd\\n'
    "_w = _sd.Stereodemo.__new__(_sd.Stereodemo)\\n"
    "_w.cmd = cmd\\n"
    "_w.menu = {}\\n"
    "_w.session = {}\\n"
    "_w.message = []\\n"
    "_w.last = None\\n"
    'cmd.set_wizard(_w)")'
)


def test_stereodemo_constructor_is_unreachable_without_a_gui_window(a8):
    """`stereodemo.py:34` -- `cmd.full_screen("off")` raises here, verbatim."""
    ws = a8
    reply = ws.call_reply("wizards.launch", "stereodemo", ["cartoon", 1])
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == "CmdException"
    assert "full_screen" in reply["error"]["traceback"]
    # ... and nothing was pushed: the browser sees an empty stack, not a
    # half-built wizard.
    assert ws.call("wizards.probe")["depth"] == 0


def test_stereodemo_panel_is_the_grouped_case_and_the_row_count_was_wrong(a8):
    """`stereodemo.py:45-72` -- the canonical grouped panel.

    Counted here rather than trusted: the parity row says "16-row panel with
    five `[1,...]` section headers"; it is **17 rows with six headers**.
    """
    ws = a8
    ws.do(_PUSH_STEREODEMO)
    ws.pump_frames(0.3)
    snap = ws.call("wizards.snapshot")
    assert snap["cls"] == "Stereodemo"

    kinds = [row["kind"] for row in snap["panel"]]
    headers = [row["text"] for row in snap["panel"] if row["kind"] == "text"]
    assert len(snap["panel"]) == 17
    assert headers == [
        "Structural Biology",
        "Drug Discovery",
        "Presentation Graphics",
        "Bioinformatics",
        "Science Education",
        "Configuration",
    ]
    assert kinds.count("button") == 11
    assert kinds.count("popup") == 0
    # ... and a header is not a button: it carries no code at all.
    assert all(row["code"] == "" for row in snap["panel"] if row["kind"] == "text")
    assert snap["panel"][1]["code"] == 'cmd.get_wizard().launch("roving_density")'


def test_benchmark_panel_opens_without_running_anything(a8):
    """`benchmark.py:25-33`, `:349-367` -- 17 rows, 16 of them buttons.

    Every button calls `delay_launch`, which `cmd.reinitialize()`s the whole
    session; none is pressed here, and the wizard's own constructor with no
    argument is inert.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("wizards.launch", "benchmark")
    snap = ws.call("wizards.snapshot")

    assert snap["cls"] == "Benchmark"
    assert len(snap["panel"]) == 17
    assert snap["panel"][0]["text"] == "Benchmarks"
    assert [r["kind"] for r in snap["panel"][1:]] == ["button"] * 16
    assert snap["panel"][1]["code"] == 'cmd.get_wizard().delay_launch("run_all")'
    assert snap["panel"][-1]["code"] == "cmd.set_wizard()"
    # the constructor really did nothing: the scene is untouched.
    assert objects(ws) == ["ala"]


def test_a_demo_body_really_runs_on_its_thread_and_the_next_one_cleans_it_up(a8):
    """`demo.py:12-31` -- `replace_wizard demo,<name>` off the panel row.

    `raster3d` is the cheapest body: it loads `$PYMOL_DATA/demo/1hpv.r3d` as
    the object `cgo1` from a daemon thread, so the reply to the panel-row exec
    comes back BEFORE the object exists -- which is exactly the "the client
    must tolerate an out-of-order wizard.changed push" claim on this row.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("wizards.launch", "demo")
    panel = ws.call("wizards.snapshot")["panel"]
    assert len(panel) == 13
    row = next(r for r in panel if r["text"] == "Molscript/R3D Input")
    assert row["code"] == "replace_wizard demo,raster3d"

    ws.call("wizards.exec_code", row["code"])

    deadline = time.monotonic() + slow(20.0)
    while time.monotonic() < deadline and "cgo1" not in objects(ws):
        ws.pump_frames(0.05)
    assert "cgo1" in objects(ws), "the demo thread never loaded the r3d file"
    assert ws.call("cmd.get_type", "cgo1") == "object:cgo"
    # replace_wizard popped the old wizard and pushed a new one: still depth 1.
    assert ws.call("wizards.probe")["depth"] == 1

    # ... and the next demo tears the previous one down through `<last>(cleanup=1)`
    ws.call("wizards.exec_code", "replace_wizard demo,finish")
    deadline = time.monotonic() + slow(10.0)
    while time.monotonic() < deadline and "cgo1" in objects(ws):
        ws.pump_frames(0.05)
    assert "cgo1" not in objects(ws)


# ===========================================================================
# ROW 381 -- toggle / dragging / openvr
# ===========================================================================


def test_toggle_wizard_has_no_self_cmd_at_all_and_still_renders(a8):
    """`toggle.py:6-16` never calls `Wizard.__init__`.

    A generic renderer that assumes `self.cmd`/`self.menu`/`self.session` exist
    dies on this one; the bridge probes with `hasattr` exactly like
    `WizardCallPython` (`packages/engine/layer1/Wizard.cpp:162`).
    """
    ws = a8
    ws.call("wizards.launch", "toggle", ["first line", "second line"])
    snap = ws.call("wizards.snapshot")

    assert snap["cls"] == "Toggle"
    line = tagged(
        ws,
        "P8TOG",
        "print('P8TOG', [hasattr(cmd.get_wizard(), a)"
        " for a in ('cmd', 'menu', 'session', 'prompt')])",
    )[0]
    assert line.endswith("[False, False, False, True]")

    assert [r["text"] for r in snap["panel"]] == [
        "Toggle Fullscreen",
        "Toggle Stereo 3D",
        "Toggle Message",
        "Dismiss",
    ]
    assert snap["prompt"] == ["first line", "second line"]
    assert snap["errors"] == []

    # the third row's code hides the prompt (`toggle.py:19-21`)
    ws.call("wizards.exec_code", snap["panel"][2]["code"])
    assert ws.call("wizards.snapshot")["prompt"] == []

    # ... and with no message at all row 2 is deleted in place: 3 rows, and the
    # third row is Dismiss, not Toggle Message (`toggle.py:39-40`).
    ws.call("wizards.dismiss", all=True)
    ws.call("wizards.launch", "toggle")
    snap = ws.call("wizards.snapshot")
    assert [r["text"] for r in snap["panel"]] == [
        "Toggle Fullscreen",
        "Toggle Stereo 3D",
        "Dismiss",
    ]
    assert snap["prompt"] == []


def test_openvr_wizard_is_purely_declarative_with_nested_submenus(a8):
    """`openvr.py:6-96` -- no `get_panel` at all; the base class returns `self.panel`."""
    ws = a8
    ws.call("wizards.launch", "openvr")
    snap = ws.call("wizards.snapshot")

    assert snap["cls"] == "Openvr"
    assert [(r["kind"], r["text"], r["code"]) for r in snap["panel"]] == [
        ("text", "OpenVR Menu", ""),
        ("popup", "Scene", "scene"),
        ("popup", "Wizard", "wizard"),
        ("popup", "VR GUI", "gui"),
    ]

    scene = ws.call("wizards.menu", "scene")["items"]
    store = next(i for i in scene if i["text"] == "Store...")
    assert [i["text"] for i in store["submenu"] if i["kind"] == "item"] == [
        "F%d" % n for n in range(1, 13)
    ]
    assert store["submenu"][1]["command"] == "scene F1, store"
    # a menu whose leaves launch OTHER wizards (openvr.py:30-35)
    wizard_menu = ws.call("wizards.menu", "wizard")["items"]
    assert [i.get("command") for i in wizard_menu if i["kind"] == "item"] == [
        "wizard measurement",
        "wizard mutagenesis",
        "wizard density",
    ]
    gui = ws.call("wizards.menu", "gui")["items"]
    assert len([i for i in gui if i["kind"] == "item"]) == 7


#: Turn dragging off and render the resulting panel WITHOUT letting a draw in
#: between -- see the block comment at the point of use.  `snapshot()` is the
#: exact function the `wizards.snapshot` wire route calls.
_DRAG_OFF_AND_SNAPSHOT = (
    'exec("import json as _json\\n'
    "import tenmol_bridge.panels.wizards as _wz\\n"
    "cmd.drag()\\n"
    "_s = _wz.snapshot()\\n"
    "print('P8DRAG', _json.dumps({'cls': _s['cls'], 'panel': _s['panel'],"
    " 'errors': _s['errors']}))\")"
)


def test_dragging_wizard_returns_a_none_panel_and_dismisses_itself(a8):
    """`dragging.py:44-56` -- `check_valid` calls `_ cmd.set_wizard()` on itself.

    `cmd.drag(sele)` is what launches it in PyMOL (`editing.py:1068-1076`), and
    it stays alive only while `get_editor_scheme() == 3`.  Turning dragging off
    makes its own `get_panel` return `None` and then pop itself off the stack --
    the two requirements this row puts on the generic renderer.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.drag", "ala and name CA+CB")

    probe = ws.call("wizards.probe")
    assert probe["depth"] == 1 and probe["cls"] == "Dragging"
    snap = ws.call("wizards.snapshot")
    # shape 1 of 2 (`dragging.py:85-95`): a subset of the atoms is being dragged
    assert [r["kind"] for r in snap["panel"]] == [
        "text",
        "text",
        "button",
        "button",
        "button",
        "button",
    ]
    assert snap["panel"][0]["text"] == "Dragging 2 atoms in"
    assert snap["panel"][1]["text"] == 'object "ala"'
    assert snap["eventMask"] == 1 + 128  # pick | dirty (dragging.py:58-59)

    # shape 2 of 2 (`dragging.py:96-102`): dragging the WHOLE object drags its
    # matrix instead, and the panel loses two rows and gains a Reset.
    ws.call("cmd.drag", "ala")
    snap = ws.call("wizards.snapshot")
    assert [(r["kind"], r["text"]) for r in snap["panel"]] == [
        ("text", "Dragging matrix for"),
        ("text", 'object "ala"'),
        ("button", "Reset"),
        ("button", "Done"),
    ]
    assert snap["panel"][2]["code"] == 'cmd.reset(object="ala")'

    # DEACTIVATE, AND RENDER IT, IN ONE PUMP TASK.  `cmd.drag()` leaves the
    # editor scheme at != 3, and the FIRST draw after that runs `WizardUpdate`
    # -> `do_dirty` -> `dragging.check_valid` -> `_ cmd.set_wizard()`
    # (dragging.py:44-56), which pops this wizard off the stack -- the wizard
    # has `dirty` in its own event mask (asserted above as 1 + 128), so it is
    # the draw that kills it.  MEASURED: with no draw in between a snapshot
    # still sees `Dragging`; after one `pump_frames(0.2)` it is already gone.
    #
    # So `cmd.drag()` + `wizards.snapshot` AS TWO ROUND TRIPS is a bet that
    # both land inside the same 16.7 ms pump batch. That held 15/15 on an idle
    # M4 and lost inside a loaded full-suite run (`assert None == 'Dragging'`),
    # and a shared runner is the loaded case. `{t:'do'}` is submitted with
    # `tick_after=True` (`packages/bridge/tenmol_bridge/dispatch.py:187`), so
    # running both in ONE `do` means nothing can draw between them: the race is
    # removed rather than widened. Nothing is weakened -- these are the same
    # three assertions on the same `wizards.snapshot()` the wire route calls
    # (`panels/wizards.py:385`), and the wire route itself is exercised twice
    # above in this very test.
    line = tagged(ws, "P8DRAG", _DRAG_OFF_AND_SNAPSHOT)[0]
    snap = json.loads(line.split("P8DRAG", 1)[1].strip())

    # get_panel now returns None -- which is a legal panel, not an error.
    assert snap["cls"] == "Dragging", (
        "the Dragging wizard was already off the stack when its panel was "
        "rendered, in the same task that deactivated it: %r" % (snap,)
    )
    assert snap["panel"] == []
    assert snap["errors"] == []

    # ... and the wizard took itself off the stack while doing it.
    deadline = time.monotonic() + slow(5.0)
    while time.monotonic() < deadline and ws.call("wizards.probe")["depth"]:
        ws.pump_frames(0.05)
    assert ws.call("wizards.probe")["depth"] == 0


# ===========================================================================
# ROW 361 -- WizardUpdate: frame / state / position / view, server-side
# ===========================================================================

#: Replace the top wizard's six update methods with recorders and open its
#: event mask to everything (1023).  `WizardRefresh` re-reads `get_event_mask`
#: (`packages/engine/layer1/Wizard.cpp:216-224`), so `cmd.refresh_wizard()` is what pushes the
#: new mask into the C layer -- without it `isEventType` still gates on
#: pick|select and nothing fires.
_RECORDER = (
    'exec("_w = cmd.get_wizard()\\n'
    "stored.p8_updates = []\\n"
    "def _mk(_n):\\n"
    "    def _f(*a):\\n"
    "        stored.p8_updates.append((_n,) + tuple(a))\\n"
    "    return _f\\n"
    "for _n in ('do_frame','do_state','do_position','do_view','do_scene','do_dirty'):\\n"
    "    setattr(_w, _n, _mk(_n))\\n"
    "_w.get_event_mask = lambda: 1023\\n"
    'cmd.refresh_wizard()")'
)


def recorded(ws):
    """The kinds of update the live wizard has been handed so far."""
    import json

    line = tagged(
        ws,
        "P8UPD",
        "print('P8UPD', __import__('json').dumps([list(map(str, e))"
        " for e in stored.p8_updates]))",
        wait=0.4,
    )[0]
    return json.loads(line.split("P8UPD", 1)[1].strip())


def wait_for_kinds(ws, kinds, timeout=15.0):
    deadline = time.monotonic() + slow(timeout)
    seen = []
    while time.monotonic() < deadline:
        seen = recorded(ws)
        if kinds <= {entry[0] for entry in seen}:
            return seen
        ws.pump_frames(0.05)
    return seen


def test_the_core_diffs_frame_state_position_and_view_with_no_client_event(a8, gl_bridge):
    """CORRECTION, measured: there IS a server-side `WizardUpdate`.

    The parity row said "there is no server-side WizardUpdate equivalent --
    nothing DIFFS frame/state/view/centre per render pass".  There is: the
    bridge's own render pump calls `ExecutiveDrawNow`, which calls
    `WizardUpdate` (`packages/engine/layer3/Executive.cpp:11554`), which is the same
    LastUpdatedFrame/State/Position/View diff as in the Qt build
    (`packages/engine/layer1/Wizard.cpp:101-131`).  Nothing in this test sends
    `wizards.event`: the frame, the state and the camera are moved with plain
    `cmd` calls and the wizard's methods are called by the core.

    Gated on `gl_bridge` because it is the DRAW that carries it.
    """
    ws = a8
    ws.subscribe("pixels")
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    ws.call("cmd.create", "p8two", "ala", 1, 1)
    ws.call("cmd.create", "p8two", "ala", 1, 2)
    assert ws.call("cmd.count_states", "p8two") == 2

    ws.call("wizards.launch", "label")
    ws.do(_RECORDER)
    ws.pump_frames(0.6)
    assert ws.call("wizards.snapshot")["eventMask"] == 1023
    ws.pump_frames(0.4)
    ws.do("stored.p8_updates = []")  # drain whatever the launch provoked

    ws.call("cmd.frame", 2)
    ws.call("cmd.set", "state", 2)
    ws.call("cmd.turn", "y", 30.0)
    # the rotation ORIGIN is what `WizardDoPosition` diffs (`Wizard.cpp:356`),
    # so move it somewhere it certainly was not.
    ws.call("cmd.origin", "", "", [5.0, 6.0, 7.0])

    seen = wait_for_kinds(ws, {"do_frame", "do_state", "do_position", "do_view"})
    kinds = {entry[0] for entry in seen}
    assert {"do_frame", "do_state", "do_position", "do_view"} <= kinds, seen

    # ... and the arguments are the real ones, not placeholders.  MEASURED
    # DIVERGENCE: `do_state` gets the `state` setting verbatim (2), but
    # `do_frame` gets the `frame` setting PLUS ONE (`Wizard.cpp:454`), so
    # `cmd.frame(2)` -- which leaves `frame` at 2 and `cmd.get_frame()` at 2 --
    # calls `do_frame(3)`.  A client that echoes the argument back as a frame
    # number would be off by one.
    assert ws.call("cmd.get_frame") == 2
    assert ws.call("cmd.get_setting_int", "frame") == 2
    assert ["do_frame", "3"] in [list(e) for e in seen], seen
    assert ["do_state", "2"] in [list(e) for e in seen], seen
    assert ws.call("cmd.get_view")[12:15] == pytest.approx([5.0, 6.0, 7.0], abs=1e-3)

    # ... and it is a DIFF, not a per-frame broadcast: with nothing moving, the
    # count of view/position events stops growing.
    settled = [e for e in recorded(ws) if e[0] in ("do_view", "do_position")]
    ws.pump_frames(slow(1.0))  # a LONGER quiet window is a stronger claim
    assert (
        len([e for e in recorded(ws) if e[0] in ("do_view", "do_position")])
        == len(settled)
    )


# ===========================================================================
# ROWS 372 / 373 -- the wizards that bind keys with cmd.set_key
# ===========================================================================

#: GLUT special codes (`packages/engine/modules/pymol/internal.py:398-421`) and the `_button`
#: state that means "special, not ascii" (`packages/engine/layer5/PyMOL.cpp:2910-2916`).
K_F1, K_F2, K_F3 = 1, 2, 3
K_LEFT, K_RIGHT = 100, 102
K_PGUP, K_PGDN = 104, 105
SPECIAL = -2

SHORTCUTS_NS = "cmd.tenmol_shortcuts"


def press(ws, code, mod=0):
    """One forwarded special keystroke, byte for byte what the client sends.

    `PyMOL_Special` runs `PParse("_special k,x,y,mod")` inline
    (`packages/engine/layer5/PyMOL.cpp:2386-2391`) and `internal._special` looks the key up in
    `cmd.key_mappings` -- the `set_key` table, which is a DIFFERENT table from
    the wizard's own `do_key`/`do_special`.
    """
    ws.input("button", button=code, state=SPECIAL, x=0, y=0, mod=mod)
    time.sleep(0.5)


def live_keys(ws):
    ws.do("import tenmol_bridge.panels.shortcuts as _ts; _ts.install()")
    result = ws.call(SHORTCUTS_NS + ".key_mappings")
    return {entry["key"]: entry for entry in result["entries"]}


def test_density_binds_pgup_pgdn_through_set_key_and_a_forwarded_key_walks_the_chain(
    a8,
):
    """`density.py:67-68` bind, `:180-186` unbind, `:209-241` next_res.

    The parity row calls the `set_key` table "a **separate keyboard table**
    from do_key -- the bridge must forward unhandled keys to the set_key table
    too".  It already does: the ordinary `{t:'input', kind:'button'}` special
    keystroke reaches `internal._special`, which finds the lambda the wizard
    installed and walks the peptide chain.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    ws.call("cmd.map_new", "p8map", "gaussian", 1.0, "p8pept")

    # NO PRECONDITION ON `pgup` HERE.  `set_key(key, None)` does not unbind in
    # this build (see the end of this test), so any earlier density wizard in
    # the shared process has already left a dead lambda on pgup/pgdn.  What
    # this test owns is that THIS wizard's binding is live and works.
    ws.call("wizards.launch", "density")
    bound = live_keys(ws)
    assert bound["pgup"]["kind"] == "callable"
    assert bound["pgdn"]["kind"] == "callable"
    assert bound["pgup"]["callable"] == "<lambda>"

    # the constructor adopts the first map it finds (density.py:61-65)
    panel = ws.call("wizards.snapshot")["panel"]
    assert panel[6]["text"] == "Map 1: p8map"

    pick(ws, "p8pept and resi 5 and name CA")
    assert ws.call("cmd.count_atoms", "_dw") == 1
    assert numbers(ws, "P8RES", "_dw", "int(resi)") == [5]

    press(ws, K_PGDN)
    assert numbers(ws, "P8RES", "_dw", "int(resi)") == [6], "pgdn did not advance"
    press(ws, K_PGDN)
    assert numbers(ws, "P8RES", "_dw", "int(resi)") == [7]
    press(ws, K_PGUP)
    assert numbers(ws, "P8RES", "_dw", "int(resi)") == [6], "pgup did not go back"

    # ... and dismissing the wizard DOES NOT unbind them.  MEASURED
    # DIVERGENCE: `density.cleanup()` calls `set_key('pgup', None)`
    # (density.py:185-186), but `fn=None` is the DECORATOR form in this build
    # (`controlling.py:766-770`) -- it returns a decorator and changes nothing.
    # The dead lambda survives the wizard, so a later pgup calls
    # `cmd.get_wizard().next_res()` with no wizard on the stack.  Any client
    # that mirrors the key table has to cope with that; this file restores
    # `cmd.key_mappings` wholesale in its fixture because of it.
    ws.call("wizards.dismiss")
    after = live_keys(ws)
    assert after["pgup"]["kind"] == "callable"
    assert after["pgdn"]["kind"] == "callable"


def test_density_isomesh_objects_reach_the_geometry_feed(a8):
    """THE THIRD CLAUSE OF THIS ROW, now closed (wave 11).

    `update_maps` builds `w1_<map>` as an `object:mesh` coloured blue.  Until
    wave 11 the Mode-G accessor answered `unsupported` for it -- it dispatched
    straight from the ObjectCGO branch to `dynamic_cast<ObjectMolecule*>` --
    so the mesh the wizard's whole purpose is to show could not reach three.js.
    `packages/engine/layer4/CmdWebGeometry.cpp` now has an ObjectMesh branch that emits
    `ObjectMeshState::N`/`::V` through the same `kind: 'mesh'` envelope
    `RepMesh` uses; `packages/bridge/tests/test_p11_geom.py` is the detailed form.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    ws.call("cmd.map_new", "p8map", "gaussian", 1.0, "p8pept")
    ws.call("wizards.launch", "density")
    pick(ws, "p8pept and resi 5 and name CA")

    assert "w1_p8map" in objects(ws)
    assert ws.call("cmd.get_type", "w1_p8map") == "object:mesh"
    assert colour_indices(ws, "?w1_p8map") == []  # not a molecular object

    result = ws.call("_bridge.get_geometry", object="w1_p8map", rep="mesh")
    assert result["status"] == "ok", result
    assert result["fallbackReason"] is None
    assert result["diagnostics"]["source"] == "ObjectMeshState::V"
    assert result["diagnostics"]["nVert"] > 100
    assert result["diagnostics"]["mapName"] == "p8map"
    assert result["bytes"] > result["diagnostics"]["nVert"] * 12


#: Count the live density wizard's `do_position` calls without changing what
#: it does -- the only way to tell "the core called it" from "the map happened
#: to move".
_COUNT_DO_POSITION = (
    'exec("_w = cmd.get_wizard()\\n'
    "stored.p8_dopos = 0\\n"
    "_orig = _w.do_position\\n"
    "def _f():\\n"
    "    stored.p8_dopos += 1\\n"
    "    return _orig()\\n"
    '_w.do_position = _f")'
)


def do_position_calls(ws):
    return int(tagged(ws, "P8DOPOS", "print('P8DOPOS', stored.p8_dopos)", wait=0.4)[0]
               .split()[-1])


def test_density_do_position_roves_the_maps_with_no_client_event(a8, gl_bridge):
    """`density.py:205-207` -- THE roving behaviour, driven by the core.

    With no `_dw` selection the isomesh is cut around the pseudo-selection
    `center`, i.e. the camera origin, and `do_position` re-cuts it whenever the
    origin moves.  Nothing is sent from the browser here: the origin is moved
    with a plain `cmd.origin` and the core's `WizardUpdate` (reached from
    `ExecutiveDrawNow`, `Executive.cpp:11554`) does the rest.

    Gated on `gl_bridge` because it is the DRAW that carries it.
    """
    ws = a8
    ws.subscribe("pixels")
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    ws.call("cmd.map_new", "p8map", "gaussian", 1.0, "p8pept")
    ws.call("wizards.launch", "density")
    assert ws.call("wizards.snapshot")["eventMask"] == 1 + 2 + 512

    ws.call("cmd.origin", "p8pept and resi 3")
    ws.call("wizards.exec_code", "cmd.get_wizard().update_maps()")
    ws.pump_frames(0.8)
    assert "w1_p8map" in objects(ws)
    assert "_dw" not in ws.call("cmd.get_names", "selections")

    # the box really is cut around the origin: 8 A (the radius) either side.
    origin = ws.call("cmd.get_view")[12:15]
    box = ws.call("cmd.get_extent", "w1_p8map")
    assert [(lo + hi) / 2.0 for lo, hi in zip(*box)] == pytest.approx(origin, abs=1e-3)

    ws.do(_COUNT_DO_POSITION)
    ws.pump_frames(0.5)
    before_calls = do_position_calls(ws)
    before_box = ws.call("cmd.get_extent", "w1_p8map")

    pump_before = _pump_state(ws)
    ws.call("cmd.origin", "p8pept and resi 12")  # the ONLY thing sent

    # Nothing here is sent from the browser, so the ONLY thing that can move
    # this forward is the draw pump reaching `WizardUpdate` from
    # `ExecutiveDrawNow` -- wait for that, do not time it.
    deadline = time.monotonic() + slow(20.0)
    calls, moved = before_calls, before_box
    while time.monotonic() < deadline:
        calls = do_position_calls(ws)
        moved = ws.call("cmd.get_extent", "w1_p8map")
        if calls > before_calls and moved != before_box:
            break
        ws.pump_frames(0.05)

    assert calls > before_calls, (
        "the core never called do_position (still %d calls).%s"
        % (calls, pump_note(ws, pump_before))
    )
    assert moved != before_box, "do_position fired but the map was not re-cut"

    # MEASURED, and narrower than the row implies: the re-cut box follows the
    # new origin in z (14.50..30.50 -> 11.99..27.99 for an origin z of 22.499
    # -> 19.986) but its x and y stayed on the OLD origin, so a roving map does
    # not fully track a diagonal move in one step.
    new_origin = ws.call("cmd.get_view")[12:15]
    centre = [(lo + hi) / 2.0 for lo, hi in zip(*moved)]
    assert centre[2] == pytest.approx(new_origin[2], abs=1e-3)


@pytest.fixture
def filtered(a8, tmp_path):
    """A 3-state object and the filter wizard, with the cwd side effect cleaned."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala")
    for state in (1, 2, 3):
        ws.call("cmd.create", "p8filt", "ala", 1, state)
    ws.call("cmd.delete", "ala")
    assert ws.call("cmd.count_states", "p8filt") == 3
    ws.call("wizards.launch", "filter")
    yield ws
    cwd = tagged(ws, "P8CWD", "print('P8CWD', __import__('os').getcwd())")[0]
    path = os.path.join(cwd.split("P8CWD", 1)[1].strip(), "p8filt.txt")
    if os.path.exists(path):
        os.remove(path)


def test_filter_binds_F1_F2_F3_and_the_arrows_through_set_key(filtered):
    """`filter.py:99-103` bind, `:394-400` unbind, and the decisions they make."""
    ws = filtered
    bound = live_keys(ws)
    for key in ("F1", "F2", "F3", "left", "right"):
        assert bound[key]["kind"] == "callable", key

    snap = ws.call("wizards.snapshot")
    assert snap["panel"][2]["text"] == "Object: p8filt"
    assert snap["prompt"][0] == (
        "p8filt: 0 accepted, 0 rejected, 0 deferred, 3 remaining"
    )
    assert snap["prompt"][1].endswith("?")

    ws.call("cmd.frame", 1)
    press(ws, K_F1)  # accept, and advance
    press(ws, K_F2)  # reject
    press(ws, K_F3)  # defer

    prompt = ws.call("wizards.snapshot")["prompt"]
    assert prompt[0] == "p8filt: 1 accepted, 1 rejected, 1 deferred, 0 remaining"

    # the arrows are the same table: back up one state and the second line of
    # the prompt reports THAT state's decision.
    assert ws.call("cmd.get_frame") == 3
    press(ws, K_LEFT)
    assert ws.call("cmd.get_frame") == 2
    assert ws.call("wizards.snapshot")["prompt"][1].endswith("Reject")
    press(ws, K_LEFT)
    assert ws.call("cmd.get_frame") == 1
    assert ws.call("wizards.snapshot")["prompt"][1].endswith("Accept")
    press(ws, K_RIGHT)
    assert ws.call("wizards.snapshot")["prompt"][1].endswith("Reject")

    # `filter.cleanup()` calls `set_key('F1', None)` (filter.py:396-400), which
    # is the decorator form in this build and unbinds nothing -- same measured
    # divergence as the density wizard.
    ws.call("wizards.dismiss")
    after = live_keys(ws)
    assert after["F1"]["kind"] == "callable"


def test_filter_create_object_and_save_write_the_decisions_out(filtered):
    """`filter.py:339-347` create_object, `:349-387` save."""
    ws = filtered
    ws.call("cmd.frame", 1)
    press(ws, K_F1)  # state 1 accepted
    press(ws, K_F1)  # state 2 accepted
    press(ws, K_F2)  # state 3 rejected

    accepted = menu_command(ws, "create", "Accepted")
    assert accepted == 'cmd.get_wizard().create_object("Accept")'
    ws.call("wizards.exec_code", accepted)
    assert "p8filt_Accept" in objects(ws)
    assert ws.call("cmd.count_states", "p8filt_Accept") == 2

    ws.call("wizards.exec_code", menu_command(ws, "create", "Rejected"))
    assert ws.call("cmd.count_states", "p8filt_Reject") == 1

    snap = ws.call("wizards.snapshot")
    assert snap["panel"][9]["text"] == "Save p8filt.txt"
    ws.call("wizards.exec_code", snap["panel"][9]["code"])
    line = ws.call("cmd.exp_path", "p8filt.txt")
    cwd = tagged(ws, "P8CWD", "print('P8CWD', __import__('os').getcwd())")[0]
    path = os.path.join(cwd.split("P8CWD", 1)[1].strip(), "p8filt.txt")
    assert os.path.exists(path), (path, line)
    text = open(path).read()
    assert text.startswith('Object\t"p8filt"\n')
    assert "Accepted\t2\n" in text
    assert "Rejected\t1\n" in text
    assert "Remaining\t0\n" in text
    assert text.count('\t"Accept"\n') == 2
    assert text.count('\t"Reject"\n') == 1


# ===========================================================================
# ROWS 358 / 359 -- a REAL mouse click drives do_pick and do_select
# ===========================================================================

IL2 = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "packages", "engine", "test",
    "dat",
    "il2.pdb",
)

#: Fractions of the viewport to try: a protein is not solid, so one point is a
#: coin toss (`test_picking.py` scans for the same reason).
CLICK_POINTS = ((0.5, 0.5), (0.45, 0.5), (0.55, 0.5), (0.5, 0.45), (0.5, 0.55))

#: Count the live wizard's do_pick/do_select without changing what they do.
_COUNT_PICKS = (
    'exec("_w = cmd.get_wizard()\\n'
    "stored.p8_picks = []\\n"
    "for _n in ('do_pick', 'do_select'):\\n"
    "    def _mk(_n, _o):\\n"
    "        def _f(*a):\\n"
    "            stored.p8_picks.append((_n,) + tuple(str(x) for x in a))\\n"
    "            return _o(*a)\\n"
    "        return _f\\n"
    "    setattr(_w, _n, _mk(_n, getattr(_w, _n)))\\n"
    'cmd.refresh_wizard()")'
)


def wizard_picks(ws):
    import json

    line = tagged(
        ws,
        "P8PICKS",
        "print('P8PICKS', __import__('json').dumps([list(e) for e in stored.p8_picks]))",
        wait=0.4,
    )[0]
    return json.loads(line.split("P8PICKS", 1)[1].strip())


def click_at(ws, fx, fy, until=None):
    """One forwarded left click, then WAIT for the pump to carry it.

    ``until`` is the observable the click is supposed to produce; the wait ends
    as soon as it appears, or as soon as the pump has drawn
    :data:`CLICK_TICKS` frames without it -- at which point this click really
    did miss the molecule and the caller should try the next candidate point.
    """
    width, height = ws.call("cmd.get_viewport")[:2]
    x, y = int(width * fx), int(height * fy)
    ws.input("button", button=0, state=0, x=x, y=y, mod=0, when=0.0)
    ws.input("button", button=0, state=1, x=x, y=y, mod=0, when=0.0)
    # `I->SingleClickDelay = 0.15` (`packages/engine/layer1/SceneMouse.cpp:1152`)
    # has to expire before the click resolves at all, and it is consumed from
    # `packages/engine/layer1/Scene.cpp:2441` -- inside the draw.
    ws.pump_frames(slow(0.3))
    if until is None:
        ws.pump_frames(slow(0.9))
        return None
    return wait_for(ws, until, ticks=CLICK_TICKS)


#: Draws to give a click before concluding it missed.  The deferred handler
#: runs on the FIRST `ExecutiveDrawNow` after the release; 24 is two orders of
#: margin on that and still only 0.4 s of a healthy 60 Hz pump.
CLICK_TICKS = 24

#: The one way a click can be carried by a healthy pump and STILL not reach the
#: wizard, so worth naming when that happens.  MEASURED with a stand-in
#: rasteriser: every click here survives a 200 ms draw and none survives a
#: 250 ms one, which is `slowest_single_click = 0.25F`
#: (`packages/engine/layer1/SceneMouse.cpp:1142-1149`) exactly -- press and
#: release are one pump cycle apart, so the draw cost IS the gap.  A real slow
#: renderer does not hit this: the budget is `0.25 + I->ApproxRenderTime`, and
#: `ApproxRenderTime` is measured across the draw itself
#: (`packages/engine/layer1/SceneRender.cpp:563`), so it grows with it.
_CLICK_WINDOW_NOTE = (
    "  If the pump DID draw, the other candidate is `slowest_single_click` "
    "(0.25 s + ApproxRenderTime, packages/engine/layer1/SceneMouse.cpp:1142): "
    "press and release are one pump cycle apart, so a draw that costs more "
    "than that budget downgrades the click to a drag and no pick is made."
)


@pytest.fixture
def clickable(a8):
    """A big centred sphere rep, so a click in the middle lands on an atom."""
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", IL2, "p8click")
    ws.call("cmd.hide", "everything")
    ws.call("cmd.show", "spheres", "p8click")
    ws.call("cmd.reset")
    ws.call("cmd.zoom", "p8click")
    # PICKING NEEDS THE EDITOR OFF, or the left click resolves to `pkat`.
    ws.call("cmd.unpick")
    ws.call("cmd.edit_mode", 0)
    for leftover in ("pk1", "pk2", "pk3", "pk4", "pkset", "pkmol", "sele"):
        ws.call("cmd.delete", leftover)
    assert ws.subscribe("pixels")["t"] == "ok"
    # The `pixels` subscription is what makes the pump draw for this client;
    # wait for it to have actually drawn rather than for a fixed 1.2 s.
    start = _pump_state(ws)
    if start is not None:
        wait_for(
            ws,
            lambda: (_pump_state(ws) or (start[0], 0))[0] >= start[0] + CLICK_TICKS,
            seconds=6.0,
        )
    else:  # pragma: no cover - render_stats unavailable
        ws.pump_frames(slow(1.2))
    yield ws
    ws.call("cmd.edit_mode", 0)
    ws.call("cmd.delete", "sele")


def test_a_real_left_click_drives_do_select_with_no_bridge_event(clickable):
    """CORRECTION, measured: nothing has to *call* `wizards.event('select')`.

    `SceneClickPickBond`/`SceneClickObject` end with
    `WizardDoSelect(G, selName, state)` (`SceneMouse.cpp:135`, `:357`), so a
    forwarded left click in viewing mode creates `sele` AND hands it to the
    wizard inside the same draw.  The parity row's gap ("nothing calls this
    automatically after a box-select or a sequence-viewer select") is wrong for
    the ordinary click-select: the C layer does it, and the bridge's input path
    is enough to reach it.
    """
    ws = clickable
    ws.call("wizards.launch", "measurement")
    ws.do(_COUNT_PICKS)
    ws.pump_frames(0.5)
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the first atom..."
    ]

    picks = []
    pump_before = _pump_state(ws)
    for fx, fy in CLICK_POINTS:
        picks = click_at(ws, fx, fy, until=lambda: wizard_picks(ws))
        if picks:
            break
    assert picks, (
        "every candidate click missed the molecule -- or nothing carried it.%s%s"
        % (pump_note(ws, pump_before), _CLICK_WINDOW_NOTE)
    )

    # measurement maps a select into a pick (measurement.py:295-303)
    assert picks[0][0] == "do_select"
    assert picks[0][1] == "sele"
    assert ["do_pick", "0"] in [list(p) for p in picks]

    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the second atom..."
    ]

    # ... and a second click completes the measurement: two mouse clicks, zero
    # `wizards.*` calls, one distance object.
    assert not [n for n in objects(ws) if n.startswith("measure")]

    def measured():
        return [n for n in objects(ws) if n.startswith("measure")]

    pump_before = _pump_state(ws)
    for fx, fy in ((0.4, 0.4), (0.6, 0.6), (0.4, 0.6), (0.6, 0.4)):
        if click_at(ws, fx, fy, until=measured):
            break
    assert measured() == ["measure01"], (
        "a second click never completed the measurement.%s%s"
        % (pump_note(ws, pump_before), _CLICK_WINDOW_NOTE)
    )


def test_a_real_left_click_in_edit_mode_drives_do_pick_with_no_bridge_event(clickable):
    """The other half of the same correction (`SceneMouse.cpp:427`, `:468`).

    In editing mode the click builds `pk1` through SelectorCreate/EditorActivate
    and calls `WizardDoPick(G, 0, state)` -- the exact work `wizards.event`
    reproduces by hand for a client that has raycast an atom itself.
    """
    ws = clickable
    ws.call("wizards.launch", "measurement")
    ws.do(_COUNT_PICKS)
    ws.call("cmd.edit_mode", 1)
    ws.pump_frames(0.5)

    picks = []
    pump_before = _pump_state(ws)
    for fx, fy in CLICK_POINTS:
        picks = click_at(ws, fx, fy, until=lambda: wizard_picks(ws))
        if picks:
            break
    assert picks, (
        "every candidate click missed the molecule -- or nothing carried it.%s%s"
        % (pump_note(ws, pump_before), _CLICK_WINDOW_NOTE)
    )

    # no do_select at all this time: the editor path goes straight to do_pick
    assert [p[0] for p in picks] == ["do_pick"]
    assert picks[0][1] == "0"  # bondFlag
    # `pk1` is gone by the time the test can look -- measurement's do_pick
    # copies it into `_mw0` and calls `cmd.unpick()` (measurement.py:311-320),
    # which is itself the proof that a real `pk1` reached the wizard.
    assert ws.call("cmd.count_atoms", "?pk1") == 0
    assert ws.call("cmd.count_atoms", "_mw0") == 1
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the second atom..."
    ]


#: `internal.modifier_keys` is indexed by the raw mask: 1 is SHFT.
SHFT = 1


def rubber_band(ws, frm=(0.3, 0.3), to=(0.7, 0.7), until=None):
    """A real shift+left press-drag-release, in viewport pixels.

    Each step is spaced with ``pump_frames`` rather than ``sleep`` so the
    socket keeps draining (these tests hold a ``pixels`` subscription), and the
    release is followed by a WAIT on ``until`` -- ``ExecutiveSelectRect`` ends
    at ``WizardDoSelect`` (`packages/engine/layer3/Executive.cpp:7563`) but it
    is reached from the deferred queue, i.e. from the next draw.
    """
    width, height = ws.call("cmd.get_viewport")[:2]
    x0, y0 = int(width * frm[0]), int(height * frm[1])
    x1, y1 = int(width * to[0]), int(height * to[1])
    ws.input("button", button=0, state=0, x=x0, y=y0, mod=SHFT, when=0.0)
    for step in range(1, 6):
        ws.input(
            "drag",
            x=x0 + (x1 - x0) * step // 5,
            y=y0 + (y1 - y0) * step // 5,
            mod=SHFT,
            when=0.0,
        )
        ws.pump_frames(slow(0.1))
    ws.input("button", button=0, state=1, x=x1, y=y1, mod=SHFT, when=0.0)
    ws.pump_frames(slow(0.3))
    if until is None:
        ws.pump_frames(slow(1.2))
        return None
    return wait_for(ws, until, ticks=CLICK_TICKS)


def test_a_box_select_drag_reaches_do_select_by_itself(clickable):
    """`ExecutiveSelectRect` ends with `WizardDoSelect` (`Executive.cpp:7563`).

    This is the other half of the row's gap ("nothing calls this automatically
    after a box-select"): a shift+left rubber band over the middle of the
    viewport selects a REGION and hands the selection name to the wizard, with
    no `wizards.event` from the browser.
    """
    ws = clickable
    ws.call("wizards.launch", "measurement")
    ws.do(_COUNT_PICKS)
    ws.pump_frames(0.5)
    total = ws.call("cmd.count_atoms", "p8click")
    pump_before = _pump_state(ws)

    def both_callbacks():
        """`do_select` maps into `do_pick` inside measurement.py:295-303, so
        the pair lands together -- waiting for one only would race the other."""
        got = wizard_picks(ws)
        return got if len(got) >= 2 else None

    rubber_band(ws, until=both_callbacks)

    picks = wizard_picks(ws)
    assert picks, (
        "the rubber band ran (`sele` exists) but no wizard callback fired.%s"
        % pump_note(ws, pump_before)
    )
    assert [p[0] for p in picks] == ["do_select", "do_pick"], picks
    assert picks[0][1] == "sele"
    # a REGION, not one atom -- and the wizard consumed the whole thing.
    picked = ws.call("cmd.count_atoms", "_mw0")
    assert picked > 50, picked
    assert picked < total
    assert ws.call("wizards.snapshot")["prompt"] == [
        "Please click on the second atom..."
    ]


# ===========================================================================
# ROW 367 -- mutagenesis: do_library, the bump scores and apply()
# ===========================================================================


def test_mutagenesis_pick_builds_the_rotamer_library_and_apply_merges_it(a8):
    """`mutagenesis.py:715-729` pick -> `:410-676` do_library -> `:326-398` apply.

    The row's untested half: a pick really does build the multi-state rotamer
    preview object (fragment + pair_fit onto the backbone + a sculpt bump score
    per rotamer), `do_state` reports the strain of the state it is shown, and
    `apply()` merges the chosen rotamer back into the real object and rebonds
    it.  Measured on residue 5 of pept.pdb mutated to TRP.
    """
    ws = a8
    ws.call("cmd.delete", "all")
    ws.call("cmd.load", PEPT, "p8pept")
    ws.call("cmd.frame", 1)
    ws.call("wizards.launch", "mutagenesis")
    assert ws.call("wizards.snapshot")["prompt"] == ["Pick a residue..."]

    before_resn = numbers(ws, "P8RESN", "p8pept and resi 5 and name CA", "resn")
    assert before_resn != ["TRP"]
    before_atoms = ws.call("cmd.count_atoms", "p8pept")

    ws.call("wizards.exec_code", 'cmd.get_wizard().set_mode("TRP")')
    pick(ws, "p8pept and resi 5 and name CA")

    # the preview object, one state per rotamer
    assert "mutation" in objects(ws)
    rotamers = ws.call("cmd.count_states", "mutation")
    assert rotamers > 1, rotamers
    assert ws.call("cmd.count_atoms", "_mutate_sel") == ws.call(
        "cmd.count_atoms", "p8pept and resi 5"
    )
    prompt = ws.call("wizards.snapshot")["prompt"][0]
    assert prompt.startswith("Select a rotamer for ")
    assert "TRP" in [
        n for n in numbers(ws, "P8MUT", "mutation and name CA", "resn")
    ]

    # do_state prints the bump score of the rotamer being shown
    # (`mutagenesis.py:678-687`), which is the sculpt scoring the row names.
    before = len(ws.feedback)
    ws.call("wizards.event", "state", state=2)
    ws.pump_frames(1.0)
    strain = [
        line for line in ws.feedback[before:] if line.strip().startswith("Rotamer 2/")
    ]
    assert strain, ws.feedback[before:][-6:]
    assert "strain=" in strain[0]

    ws.call("wizards.exec_code", "cmd.get_wizard().apply()")
    ws.pump_frames(0.6)

    # the mutation landed in the REAL object and the preview is gone
    assert numbers(ws, "P8RESN", "p8pept and resi 5 and name CA", "resn") == ["TRP"]
    assert "mutation" not in objects(ws)
    assert ws.call("cmd.count_atoms", "p8pept") != before_atoms
    # ... and it is bonded to its neighbours, not floating (the `cmd.bond` +
    # `set_geometry` half of apply()).
    assert ws.call(
        "cmd.count_atoms",
        "(p8pept and resi 5 and name N) and neighbor (p8pept and resi 4)",
    ) == 1
