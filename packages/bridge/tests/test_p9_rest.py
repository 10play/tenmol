"""Wave 9 — the leftovers of areas 7 and 9 that a test can actually reach.

WHAT IS IN HERE AND WHY IT IS HERE

* Row 328's last open item, the **presentation auto-quit chain**
  (``packages/engine/modules/pymol/viewing.py:1107-1113``).  Wave 8 left it open with the note
  that it "ends in ``cmd.quit()`` and would kill the PyMOL every other test in
  the run shares".  Both halves of the chain are exercised below without ever
  reaching that call:

    - ``chain_session`` (``viewing.py:935-959``) is run FIVE ways against a
      stub ``_self``.  A stub is not a convenience here, it is the only safe
      option: the function's success path is
      ``_self.do("_ cmd.load(r'''<next>''',format='psw')")`` and ``load_pse``
      (``importing.py:829-853``) calls ``set_session(..., steal=1)``, which
      REPLACES the whole session -- objects, colours, settings -- for every
      other test in the process.
    - the five-way guard in ``scene()`` is read off the LIVE engine, including
      the ``pymol._scene_quit_on_action`` latch that arms it.

  The one statement no test in a shared process can execute is ``_self.quit()``
  itself, and that is a property of the harness, not of the client.

* Row 415's remaining item, the **sculpt tick loop**: the client half is in
  ``apps/web/src/features/builder``; this file pins the engine contract it
  drives (``cmd.sculpt_iterate`` moves coordinates while ``sculpting`` is on,
  and stops moving them once the object is deactivated).

Everything here is engine-side.  Nothing loads a session, deletes a colour or
leaves a setting changed.
"""

from __future__ import annotations

import os
import shutil
from typing import Any, Dict, List

import pytest

from conftest import RunningBridge, WSClient


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def _echo_free(lines: List[str], tag: str) -> List[str]:
    """Feedback lines carrying ``tag`` MINUS PyMOL's echo of the command.

    PyMOL prints the command back before running it, so the line containing the
    literal ``print('TAG', ...)`` is not output.
    """
    return [line for line in lines if line.strip().startswith(tag)]


def _tagged(bridge: RunningBridge, ws: WSClient, tag: str, statement: str) -> str:
    """Run one Python statement in the engine and return its tagged output.

    ATTRIBUTES ARE NOT FETCHABLE over the dispatcher (it invokes callables), so
    a print is the only way to read ``pymol._scene_quit_on_action`` or to call
    a module-level function with an argument the wire cannot carry.
    """
    ws.do("%s; print('%s', _p9)" % (statement, tag))
    lines = bridge.wait_for_feedback(tag, timeout=5.0)
    hits = _echo_free(lines, tag)
    assert hits, "no %s line; feedback tail=%r" % (tag, lines[-6:])
    return hits[-1].strip()[len(tag) :].strip()


# ``re_pat.sub`` in ``chain_session`` rewrites EVERY ``[0-9]+\.`` in the whole
# path, directories included (measured below), so the fixture must live under a
# prefix that contains none.  ``/tmp`` does; a pytest ``tmp_path`` on macOS sits
# under ``/private/var/folders/<hash>/...`` and may not.
CHAIN_DIR = "/tmp/tenmol-p9-chain"


@pytest.fixture
def chain_dir() -> str:
    shutil.rmtree(CHAIN_DIR, ignore_errors=True)
    os.makedirs(CHAIN_DIR)
    try:
        yield CHAIN_DIR
    finally:
        shutil.rmtree(CHAIN_DIR, ignore_errors=True)


def _chain(bridge: RunningBridge, ws: WSClient, tag: str, session_file: str) -> str:
    """``viewing.chain_session`` against a stub ``_self``: (returned, log)."""
    statement = (
        "import pymol.viewing as _V, types as _T; "
        "_log=[]; "
        "_st=_T.SimpleNamespace(get=lambda k: %r, do=_log.append); "
        "_p9=(_V.chain_session(_st), _log)" % (session_file,)
    )
    return _tagged(bridge, ws, tag, statement)


# --------------------------------------------------------------------------- #
# Row 328 -- the presentation auto-quit chain
# --------------------------------------------------------------------------- #


def test_chain_session_loads_the_next_numbered_file_and_says_so(
    bridge: RunningBridge, ws: WSClient, chain_dir: str
) -> None:
    """``pres1.pse`` chains to ``pres2.pse`` -- and only when it exists."""
    first = os.path.join(chain_dir, "pres1.pse")
    second = os.path.join(chain_dir, "pres2.pse")

    # No successor yet: the chain reports failure, which is the branch that
    # makes ``scene()`` call ``quit()``.
    assert _chain(bridge, ws, "P9CHAINA", first) == "(0, [])"

    open(second, "wb").close()
    got = _chain(bridge, ws, "P9CHAINB", first)
    assert got.startswith("(1, [")
    # The exact command it hands to the parser -- `_ ` prefix is the
    # logging-suppression form, and psw is what forces presentation mode.
    assert ("_ cmd.load(r'''%s''',format='psw')" % second) in got


def test_chain_session_falls_back_between_pse_and_psw(
    bridge: RunningBridge, ws: WSClient, chain_dir: str
) -> None:
    """``viewing.py:951-955``: try ``.pse``, then the other extension."""
    first = os.path.join(chain_dir, "talk1.pse")
    open(os.path.join(chain_dir, "talk2.psw"), "wb").close()
    got = _chain(bridge, ws, "P9CHAINC", first)
    assert got.startswith("(1, [")
    assert "talk2.psw" in got and "talk2.pse" not in got


def test_chain_session_keeps_the_zero_padding_of_the_number_it_found(
    bridge: RunningBridge, ws: WSClient, chain_dir: str
) -> None:
    """``new_form = "%0" + str(len(pat)-1) + "d."`` -- ``09.`` -> ``10.``."""
    first = os.path.join(chain_dir, "deck09.pse")
    open(os.path.join(chain_dir, "deck10.pse"), "wb").close()
    got = _chain(bridge, ws, "P9CHAIND", first)
    assert "deck10.pse" in got

    # Two digits stay two digits, so 08 -> 09 and not 8 -> 9.
    open(os.path.join(chain_dir, "deck09.pse"), "wb").close()
    got = _chain(bridge, ws, "P9CHAINE", os.path.join(chain_dir, "deck08.pse"))
    assert "deck09.pse" in got


def test_chain_session_skips_up_to_ten_missing_numbers_and_no_more(
    bridge: RunningBridge, ws: WSClient, chain_dir: str
) -> None:
    """``for new_num in range(file_no, file_no+11)`` -- a measured window."""
    open(os.path.join(chain_dir, "gap12.pse"), "wb").close()
    # 1 -> looks at 2..12, so a ten-file hole is crossed.
    got = _chain(bridge, ws, "P9CHAINF", os.path.join(chain_dir, "gap1.pse"))
    assert "gap12.pse" in got

    # 13 is one past the end of the window from 1... but the window from 1 is
    # 2..12, so a file at 13 is NOT reached.
    open(os.path.join(chain_dir, "hole13.pse"), "wb").close()
    got = _chain(bridge, ws, "P9CHAING", os.path.join(chain_dir, "hole1.pse"))
    assert got == "(0, [])"


def test_chain_session_gives_up_when_the_name_carries_no_number(
    bridge: RunningBridge, ws: WSClient, chain_dir: str
) -> None:
    """No ``[0-9]+\\.`` anywhere in the path -> no chain, and then ``quit()``."""
    open(os.path.join(chain_dir, "onlyone.pse"), "wb").close()
    assert _chain(bridge, ws, "P9CHAINH", os.path.join(chain_dir, "onlyone.pse")) == "(0, [])"
    # An unsaved session is the same case: ``session_file`` is ''.
    assert _chain(bridge, ws, "P9CHAINI", "") == "(0, [])"


def test_chain_session_rewrites_numbers_in_the_DIRECTORY_too(
    bridge: RunningBridge, ws: WSClient, chain_dir: str
) -> None:
    """MEASURED UPSTREAM DEFECT, and the reason this file avoids ``tmp_path``.

    ``re_pat`` is ``search``ed and ``sub``bed over the WHOLE path
    (``viewing.py:942,950``), and ``re.sub`` has no count limit, so:

      * the number that gets incremented is the FIRST ``digits.`` anywhere in
        the path -- a directory's, if it has one;
      * and the replacement is written over EVERY ``digits.`` in the path.

    A talk at ``.../2024.run/pres1.pse`` therefore does not chain to
    ``.../2024.run/pres2.pse`` and not even to ``.../2025.run/pres1.pse``: it
    looks for ``.../2025.run/pres2025.pse``.  Both halves are asserted, in that
    order, because the first is what a user would hit and the second is the
    proof of why.
    """
    old = os.path.join(chain_dir, "2024.run")
    new = os.path.join(chain_dir, "2025.run")
    os.makedirs(old)
    os.makedirs(new)
    # The two files a reasonable person would expect it to find.
    open(os.path.join(old, "pres2.pse"), "wb").close()
    open(os.path.join(new, "pres1.pse"), "wb").close()

    assert _chain(bridge, ws, "P9CHAINJ", os.path.join(old, "pres1.pse")) == "(0, [])"

    # The one it is really looking for.
    open(os.path.join(new, "pres2025.pse"), "wb").close()
    got = _chain(bridge, ws, "P9CHAINK", os.path.join(old, "pres1.pse"))
    assert got.startswith("(1, [")
    assert "2025.run/pres2025.pse" in got


def _arm(ws: WSClient) -> None:
    """Walk two scenes off the end of the list, which is what arms the quit.

    MEASURED, and it is not what the row's prose implies: with ``scene_loop``
    off, ``next`` from the LAST scene does not stay there and does not wrap --
    it blanks ``scene_current_name`` (and the screen).  A second ``next`` then
    wraps to the first.  So the quit candidate is the moment right after the
    blanking: latch ``next`` from the previous call AND an empty current name.
    """
    ws.call("cmd.scene", "p9quit_a", "recall", animate=0, quiet=1)
    ws.call("cmd.scene", "", "next", animate=0, quiet=1)  # -> p9quit_b
    ws.call("cmd.scene", "", "next", animate=0, quiet=1)  # -> '' (blank)


def test_the_presentation_auto_quit_chain_fires_end_to_end_with_quit_stubbed(
    bridge: RunningBridge, ws: WSClient
) -> None:
    """The whole of ``viewing.py:1106-1113``, executed, with ONE stub.

    Every conjunct of the guard is satisfied for real -- the
    ``pymol._scene_quit_on_action`` latch (a module attribute written AFTER
    each call, ``:1128``, and compared BEFORE the next one), the blank
    ``scene_current_name``, and both settings -- and the chain really runs.
    ``session_file`` is emptied first so that ``chain_session`` takes its
    no-successor branch and returns 0 with no ``do()`` at all, which is the
    branch that reaches ``_self.quit()``.

    ``cmd.quit`` is the single stub, restored in ``finally``.  It has to be:
    the bridge routes the DISPATCHER's ``cmd.quit`` to its own shutdown, but
    this call is PyMOL calling itself from inside ``viewing.scene`` and would
    take the process down.  ``SingletonPyMOL.start`` sets ``self.cmd`` to the
    ``pymol.cmd`` MODULE (``packages/engine/modules/pymol2/__init__.py:53-63``) and
    ``viewing.scene``'s ``_self`` defaults to that same module, so patching the
    module attribute is what the call resolves.

    The control at the end is the mutation test: with ``presentation`` off and
    everything else identical, the same sequence must NOT reach the stub.
    """
    saved = {
        name: ws.call("cmd.get", name)
        for name in ("presentation", "presentation_auto_quit", "session_file")
    }
    patched = False
    try:
        ws.call("cmd.scene", "p9quit_a", "store", quiet=1)
        ws.call("cmd.scene", "p9quit_b", "store", quiet=1)

        # A no-op chain: no session file -> no successor -> return 0 -> quit().
        ws.call("cmd.set", "session_file", "", quiet=1)

        ws.do(
            "import pymol.cmd as _pc; _p9quit=[]; _p9orig=_pc.quit; "
            "_pc.quit=lambda *a, **k: _p9quit.append(1)"
        )
        patched = True
        assert _tagged(bridge, ws, "P9QUITA", "_p9=(_p9quit, _pc.quit is _p9orig)") == (
            "([], False)"
        )

        _arm(ws)
        state = _tagged(
            bridge,
            ws,
            "P9QUITB",
            "import pymol; _p9=(pymol._scene_quit_on_action, "
            "_pc.get('scene_current_name'))",
        )
        assert state == "('next', '')"

        ws.call("cmd.set", "presentation", 1, quiet=1)
        ws.call("cmd.set", "presentation_auto_quit", 1, quiet=1)

        # THE CALL. Guard true -> chain_session -> 0 -> quit().
        ws.call("cmd.scene", "", "next", animate=0, quiet=1)
        assert _tagged(bridge, ws, "P9QUITC", "_p9=len(_p9quit)") == "1"

        # CONTROL: presentation off, same arming, no quit.
        ws.call("cmd.set", "presentation", 0, quiet=1)
        _arm(ws)
        ws.call("cmd.scene", "", "next", animate=0, quiet=1)
        assert _tagged(bridge, ws, "P9QUITD", "_p9=len(_p9quit)") == "1"

        # CONTROL 2: presentation on, auto_quit off -> still no quit.
        ws.call("cmd.set", "presentation", 1, quiet=1)
        ws.call("cmd.set", "presentation_auto_quit", 0, quiet=1)
        _arm(ws)
        ws.call("cmd.scene", "", "next", animate=0, quiet=1)
        assert _tagged(bridge, ws, "P9QUITE", "_p9=len(_p9quit)") == "1"
    finally:
        if patched:
            ws.do("import pymol.cmd as _pc; _pc.quit=_p9orig")
            assert _tagged(bridge, ws, "P9QUITZ", "_p9=_pc.quit is _p9orig") == "True"
        for name, value in saved.items():
            ws.call("cmd.set", name, value, quiet=1)
        ws.call("cmd.scene", "p9quit_a", "delete", quiet=1)
        ws.call("cmd.scene", "p9quit_b", "delete", quiet=1)


def test_one_next_can_never_auto_quit_because_the_latch_is_written_after(
    bridge: RunningBridge, ws: WSClient
) -> None:
    """``pymol._scene_quit_on_action`` is set at ``:1128``, AFTER the C call.

    So the guard compares against the PREVIOUS action, and a single ``next``
    -- however blank the screen -- can never quit.  This is the half of the
    chain that has no setting to hide behind.
    """
    saved = ws.call("cmd.get", "presentation")
    assert saved in ("off", "0", "0.00000", 0.0, False), (
        "presentation must be off for the rest of the suite, got %r" % (saved,)
    )
    ws.call("cmd.scene", "p9latch_a", "store", quiet=1)
    try:
        ws.call("cmd.scene", "p9latch_a", "recall", animate=0, quiet=1)
        assert (
            _tagged(bridge, ws, "P9LATCHA", "import pymol; _p9=pymol._scene_quit_on_action")
            == "recall"
        )
        ws.call("cmd.scene", "", "next", animate=0, quiet=1)
        assert (
            _tagged(bridge, ws, "P9LATCHB", "import pymol; _p9=pymol._scene_quit_on_action")
            == "next"
        )
    finally:
        ws.call("cmd.scene", "p9latch_a", "delete", quiet=1)


# --------------------------------------------------------------------------- #
# Row 341 -- the sequence viewer's two right-click popups
# --------------------------------------------------------------------------- #


@pytest.fixture
def seqview(ws: WSClient) -> WSClient:
    ws.do("/from tenmol_bridge.panels import seqview; seqview.install()")
    assert ws.call("cmd.tenmol_seqview", "install")["installed"] is True
    return ws


def test_an_unselected_cell_raises_seq_option_on_a_seeker_temporary(
    seqview: WSClient,
) -> None:
    """``Seeker.cpp:366-390``: build ``_seeker``, then ``menu.seq_option``.

    Two things are asserted that a screenshot could not: the menu is built on
    the TEMPORARY, so every leaf refers to ``_seeker`` and not to the object,
    and the title is ``ObjectMoleculeGetAtomSele`` of the first atom, which
    ``menu.seq_option`` then cuts back to the last ``/``
    (``packages/engine/modules/pymol/menu.py:1801-1804``).
    """
    ws = seqview
    ws.call("cmd.fragment", "trp", "p9menu")
    try:
        # `cmd.index` gives (object, INDEX) pairs; `cmd.identify` gives IDs,
        # which are 0-based on a fragment and are NOT what the `index` keyword
        # takes -- the seqview panel addresses cells by index throughout.
        atoms = [int(index) for _, index in ws.call("cmd.index", "p9menu and resi 2 and name N+CA+C")]
        assert atoms
        reply = ws.call("cmd.tenmol_seqview", "menu", "p9menu", atoms, 0)
        assert reply["menu"] == "seq_option"
        assert reply["sele"] == "_seeker"
        assert reply["title"].startswith("/p9menu/")
        assert "TRP" in reply["title"]

        texts = [item["text"] for item in reply["items"]]
        # The title row menu.seq_option built for itself: the atom path, cut.
        assert texts[0] == reply["title"].rsplit("/", 1)[0] + "/"
        for label in ("color", "show", "hide", "preset", "label", "ss", "zoom", "clean"):
            assert label in texts, texts

        leaves = {
            item["text"]: item.get("command")
            for item in reply["items"]
            if "command" in item
        }
        assert leaves["zoom"] == 'cmd.zoom("_seeker",animate=-1)'
        assert leaves["origin"] == 'cmd.origin("_seeker")'
        # …and `_seeker` really is those atoms, so the leaves are not aimed at
        # a selection that no longer exists.
        assert int(ws.call("cmd.count_atoms", "_seeker")) == len(atoms)

        # The submenus are EAGER lists here (`mol_color(self_cmd, sele)` is
        # called while the menu is built), so the client needs no `expand`
        # round trip for them -- measured, not assumed.
        colour = next(item for item in reply["items"] if item["text"] == "color")
        assert "items" in colour and len(colour["items"]) > 5
        assert not any(item.get("lazy") for item in reply["items"])
    finally:
        ws.call("cmd.delete", "p9menu")
        ws.call("cmd.delete", "_seeker")


def test_a_selected_cell_raises_pick_sele_on_the_ACTIVE_SELECTION(
    seqview: WSClient,
) -> None:
    """``Seeker.cpp:363-365``: the other branch, and it is a different menu.

    `ExecutiveGetActiveSeleName(...) && col->inverse` -> ``pick_sele`` on the
    SELECTION, whose leaves therefore name the selection and include the
    ``disable`` entry ``seq_option`` does not have (``menu.py:1712``).
    """
    ws = seqview
    ws.call("cmd.fragment", "trp", "p9menu2")
    try:
        ws.call("cmd.select", "p9sele", "p9menu2 and resi 2", enable=1, quiet=1)
        atoms = [int(index) for _, index in ws.call("cmd.index", "p9menu2 and name CA")]
        reply = ws.call("cmd.tenmol_seqview", "menu", "p9menu2", atoms, 1)
        assert reply["menu"] == "pick_sele"
        # The active selection is what `ExecutiveGetActiveSeleName` answers --
        # the panel does not choose it.
        assert reply["sele"] == reply["title"]
        assert reply["sele"] != "_seeker"
        texts = [item["text"] for item in reply["items"]]
        assert "disable" in texts
        assert texts[0] == reply["sele"]
        leaves = {i["text"]: i.get("command") for i in reply["items"] if "command" in i}
        assert leaves["disable"] == 'cmd.disable("%s")' % reply["sele"]
        assert leaves["zoom"] == 'cmd.zoom("%s",animate=-1)' % reply["sele"]
    finally:
        ws.call("cmd.delete", "p9sele")
        ws.call("cmd.delete", "p9menu2")


def test_the_popup_is_empty_when_there_is_nothing_to_raise_it_on(
    seqview: WSClient,
) -> None:
    """A right click outside a cell with NO active selection.

    ``ExecutiveGetActiveSeleName`` fails and there is no row to fall through to,
    so the C raises nothing at all. The panel answers the same way rather than
    inventing a menu on ``all``.
    """
    ws = seqview
    for name in ws.call("cmd.get_names", "public_selections") or []:
        ws.call("cmd.disable", name)
    reply = ws.call("cmd.tenmol_seqview", "menu", "", [], 1)
    assert reply == {"menu": "", "sele": "", "title": "", "items": []}


# --------------------------------------------------------------------------- #
# Row 333 -- the scene-button geometry, pinned to the C it was ported from
# --------------------------------------------------------------------------- #


_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
_GEOMETRY_TS = os.path.join(
    _REPO, "apps", "web", "src", "features", "scenes", "sceneButtonGeometry.ts"
)


def _c_defines(*paths: str) -> Dict[str, str]:
    """``#define NAME VALUE`` from the given upstream sources."""
    import re

    out: Dict[str, str] = {}
    for path in paths:
        with open(os.path.join(_REPO, path), "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                match = re.match(r"\s*#define\s+(Scene\w+)\s+(.+?)\s*$", line)
                if match:
                    # Scene.cpp redefines SceneTopMargin; last one wins, as the
                    # preprocessor does for the code below it.
                    out[match.group(1)] = match.group(2)
    return out


def _ts_consts() -> Dict[str, int]:
    import re

    with open(_GEOMETRY_TS, "r", encoding="utf-8") as fh:
        source = fh.read()
    return {
        name: int(value)
        for name, value in re.findall(r"export const (SCENE_\w+) = (-?\d+);", source)
    }


def test_scene_button_geometry_matches_Scene_cpp(ws: WSClient) -> None:
    """Row 333's port is not allowed to drift from ``SceneDrawButtons``.

    The web client cannot import a C header, so the constants are transcribed
    into ``apps/web/src/features/scenes/sceneButtonGeometry.ts``.  This re-reads
    BOTH sides -- the ``#define``s and the TypeScript -- and compares them, so a
    ``#define`` that moves upstream, or a number edited on the client, fails
    here.  It is not a copy of either file: both are parsed at run time.
    """
    defines = _c_defines("packages/engine/layer1/Scene.cpp", "packages/engine/layer1/Scene.h")
    consts = _ts_consts()

    # DIP-scaled ones: `#define X DIP2PIXEL(n)` <-> `SCENE_X_DIP = n`.
    for macro, key in (
        ("SceneToggleWidth", "SCENE_TOGGLE_WIDTH_DIP"),
        ("SceneTextLeftMargin", "SCENE_TEXT_LEFT_MARGIN_DIP"),
        ("SceneScrollBarMargin", "SCENE_SCROLLBAR_MARGIN_DIP"),
        ("SceneScrollBarWidth", "SCENE_SCROLLBAR_WIDTH_DIP"),
    ):
        assert defines[macro] == "DIP2PIXEL(%d)" % consts[key], (macro, defines[macro])

    # Unscaled ones.
    assert defines["SceneRightMargin"] == str(consts["SCENE_RIGHT_MARGIN"])
    assert defines["SceneTopMargin"] == str(consts["SCENE_TOP_MARGIN"])
    assert defines["SceneBottomMargin"] == str(consts["SCENE_BOTTOM_MARGIN"])

    # The three literals that live in the function body rather than in a
    # #define -- grepped out of the source so they cannot rot silently either.
    with open(os.path.join(_REPO, "packages", "engine", "layer1", "Scene.cpp"), "r", encoding="utf-8") as fh:
        body = fh.read()
    assert (
        "int charWidth = DIP2PIXEL(%d);" % consts["SCENE_CHAR_WIDTH_DIP"]
    ) in body
    assert ("int op_cnt = %d;" % consts["SCENE_OP_CNT"]) in body
    assert (
        "x2 = x + len * charWidth + DIP2PIXEL(%d);" % consts["SCENE_BUTTON_PAD_DIP"]
    ) in body
    assert (
        "(SceneTextLeftMargin + SceneRightMargin + %d)" % consts["SCENE_MAX_CHAR_SLACK"]
    ) in body
    assert (
        "(block->rect.right - block->rect.left) > %d" % consts["SCENE_MIN_BLOCK_WIDTH"]
    ) in body


def test_the_geometry_inputs_are_live_engine_numbers(ws: WSClient) -> None:
    """The two settings the port reads, and the block it lays out in.

    Nothing is invented client-side: ``internal_gui_control_size`` is the row
    height (``Scene.cpp:2901``), ``display_scale_factor`` IS ``_gScaleFactor``
    (``Setting.cpp:2946-2951``), and the block is the scene rect, i.e. the
    viewport.
    """
    assert ws.call("cmd.get_setting_int", "internal_gui_control_size") == 18
    assert ws.call("cmd.get_setting_int", "display_scale_factor") == 1
    width, height = ws.call("cmd.get_viewport")
    assert (width, height) == (800, 600)
    # n_disp for that block, the number the client's scrollbar turns on at.
    assert (height // 18) - 1 == 32


# --------------------------------------------------------------------------- #
# Row 415 -- what the client's sculpt ticker drives
# --------------------------------------------------------------------------- #


def _max_delta(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    return max(
        max(abs(p - q) for p, q in zip(x, y)) for x, y in zip(a["coords"], b["coords"])
    )


def _coords(ws: WSClient, name: str) -> Dict[str, Any]:
    model = ws.call("cmd.get_model", name)
    return {"coords": [atom["coord"] for atom in model["atom"]]}


def test_builder_sculpt_tick_is_the_idle_loop_the_bridge_does_not_run(
    ws: WSClient,
) -> None:
    """``cmd.builder_sculpt_tick`` == one turn of ``PyMOL_Idle``'s sculpt step.

    Same gate (the ``sculpting`` setting, ``packages/engine/layer1/Control.cpp:397-403``), same
    object set (every molecular object, ``Executive.cpp:7120-7133`` /
    ``:7164-7173``), same cycle count (``sculpting_cycles``).  The reply is what
    the client's ticker reads to decide whether to schedule another frame.
    """
    name = "p9tick"
    saved = ws.call("cmd.get_setting_boolean", "sculpting")
    ws.do("/from tenmol_bridge.panels.builder import install;install()")
    try:
        # OFF: inactive, and -- the point -- it does not iterate anything.
        ws.call("cmd.set", "sculpting", 0, quiet=1)
        idle = ws.call("cmd.builder_sculpt_tick")
        assert idle["active"] is False and idle["cycles"] == 0

        ws.call("cmd.fragment", "ala", name)
        ws.call("cmd.sculpt_activate", name)
        ws.call("cmd.alter_state", 1, "%s and name CB" % name, "x=x+1.0")
        ws.call("cmd.rebuild", name)
        before = _coords(ws, name)

        ws.call("cmd.set", "sculpting", 1, quiet=1)
        # A tick with sculpting OFF must not have moved anything: prove it by
        # showing the FIRST on-tick is what moves the atom.
        assert _max_delta(before, _coords(ws, name)) == 0.0

        first = ws.call("cmd.builder_sculpt_tick")
        assert first["active"] is True
        assert first["cycles"] == ws.call("cmd.get_setting_int", "sculpting_cycles")
        assert first["strain"] > 0.0
        after = _coords(ws, name)
        assert _max_delta(before, after) > 1e-4

        # Strain falls as the minimisation converges -- what the panel shows.
        strains = [ws.call("cmd.builder_sculpt_tick")["strain"] for _ in range(6)]
        assert strains[-1] < first["strain"], strains

        # An explicit cycle count overrides the setting, so a client can trade
        # smoothness for round trips.
        assert ws.call("cmd.builder_sculpt_tick", 3)["cycles"] == 3
    finally:
        ws.call("cmd.set", "sculpting", 1 if saved else 0, quiet=1)
        ws.call("cmd.sculpt_deactivate", name)
        ws.call("cmd.delete", name)


def test_sculpt_iterate_moves_coordinates_only_while_the_object_is_active(
    ws: WSClient,
) -> None:
    """The engine contract behind the client's sculpt tick loop.

    `builder.py:134-225`'s SculptWizard turns `sculpting` on and leaves the
    stepping to whoever draws the frames -- in Qt, the GL idle loop.  There is
    no idle loop here, so the CLIENT ticks: `cmd.sculpt_iterate(obj, state, n)`
    per animation frame.  What that call is worth is measured here, both ways.
    """
    name = "p9sculpt"
    saved = ws.call("cmd.get_setting_boolean", "sculpting")
    try:
        ws.call("cmd.fragment", "ala", name)
        ws.call("cmd.sculpt_activate", name)
        ws.call("cmd.set", "sculpting", 1, quiet=1)
        # Displace one atom so the force field has something to relax.
        ws.call("cmd.alter_state", 1, "%s and name CB" % name, "x=x+1.0")
        ws.call("cmd.rebuild", name)

        before = _coords(ws, name)
        ws.call("cmd.sculpt_iterate", name, 1, 10)
        after = _coords(ws, name)
        moved = _max_delta(before, after)
        assert moved > 1e-4, "sculpt_iterate did nothing: %r" % moved

        # Deactivated: the same call is a no-op, which is what lets the client
        # stop its ticker on `Done` and be sure nothing else is moving.
        ws.call("cmd.sculpt_deactivate", name)
        before = _coords(ws, name)
        ws.call("cmd.sculpt_iterate", name, 1, 10)
        after = _coords(ws, name)
        assert _max_delta(before, after) == 0.0
    finally:
        ws.call("cmd.set", "sculpting", 1 if saved else 0, quiet=1)
        ws.call("cmd.delete", name)
