"""Wave 10, the wizard block: the catalogue accounting, and Cleanup for real.

Two inventory rows meet here.

ROW 108 (**wizard panel block**) was downgraded by the wave-9 audit on
arithmetic: the row claimed "24 of 24 accounted for" while
``wizards.catalog`` returns **25** entries, and the assertion meant to hold the
number still was ``len(catalog) >= 24`` -- a lower bound that a 26th wizard
would satisfy too.  So the accounting is done here ONCE, in one test, over the
whole live catalogue, and it is COMPUTED rather than narrated: every name the
catalogue offers is launched and walked except the one that is justified in
writing, and the partition is asserted to cover the catalogue exactly.

ROW 371 (**cleanup/szybki wizard**) has been "blocked on OpenEye" since wave 4:
``cmd.wizard('cleanup')`` raises at construction because ``$OE_DIR/bin/szybki``
does not exist on this machine, so neither its 7-row panel nor ``run()`` had
ever been seen.  ``auto_configure`` (``wizard/cleanup.py:13-34``) only ever asks
the filesystem whether ``$OE_DIR/bin/szybki`` EXISTS and is then handed to
``cmd.system`` as a command line, so a stub executable that honours the same
file contract (``-i ligand_inp.mol -o ligand_out.mol``) drives the wizard's
entire code path.  What that stub cannot prove is OpenEye's *chemistry*; what it
does prove is every line of ``cleanup.py`` -- save, system, load, fit, update,
undo/redo object copies and the panel -- which is all the client can ever see.
"""

from __future__ import annotations

import ast
import os
import shutil
import stat
import tempfile
from typing import Any, Dict, List

import pytest

# ---------------------------------------------------------------------------
# shared-process guards
# ---------------------------------------------------------------------------

#: Globals the stock wizards write while merely being CONSTRUCTED.  Same list
#: as ``test_p8_a2.py::_WIZARD_GLOBALS`` and ``test_p9_gui.py``, for the same
#: reason: ``sculpting`` turns editing on, and ``mouse_selection_mode`` leaking
#: to 0 breaks ``test_selection_modes.py`` a thousand tests later.
_WIZARD_GLOBALS = (
    "mouse_selection_mode",
    "button_mode",
    "button_mode_name",
    "auto_zoom",
    "sculpting",
    "auto_sculpt",
    "suspend_updates",
    "editor_auto_dihedral",
    "valence",
    "stereo_mode",
)


#: Makes every ``print`` tag unique so a stale feedback line from an earlier
#: test can never be mistaken for this one's.
_TICK = [0]


def _tagged(bridge: Any, tag: str) -> str:
    """The last non-echo feedback line carrying ``tag``.

    SKIP THE ECHO: ``cmd.do`` prints the command line itself first, and the
    command line contains the tag.
    """
    return next(
        line
        for line in reversed(bridge.wait_for_feedback(tag))
        if tag in line and not line.lstrip().startswith("PyMOL>")
    )


@pytest.fixture
def wizard_guard(ws: Any, bridge: Any):
    """Snapshot every global these wizards can write, and assert it came back."""
    before = {name: ws.call("cmd.get", name) for name in _WIZARD_GLOBALS}
    names_before = set(ws.call("get_names", "all", 0) or ())
    scheme_before = ws.call("get_editor_scheme")
    # `cmd.key_mappings` is global too, and TWO of the walked wizards write it:
    # `filter.py` binds F1/F2/F3 and the arrows, `density.py:246-247` binds
    # pgup/pgdn.  MEASURED, this run: neither comes back on its own, because
    # `density.cleanup()`'s `set_key('pgup', None)` does not unbind in this
    # build (`fn=None` is the DECORATOR form, `controlling.py:766-770`), so the
    # dead lambda outlives the wizard -- and with it live,
    # `test_p8_a1.py::test_pgup_and_pgdn_pressed_as_KEYS_step_the_scene_bin`
    # fails with "PgDn did not advance the scene".  Restored wholesale.
    _TICK[0] += 1
    tag = "P10KEYS%d" % _TICK[0]
    ws.do(
        "/import pymol;pymol._p10_keys = dict(cmd.key_mappings);"
        "print('%sA', len(cmd.key_mappings))" % tag
    )
    size_before = int(_tagged(bridge, tag + "A").split(tag + "A", 1)[1])
    yield
    # Identity, not equality: every binding must be the SAME object it was, so
    # a key REBOUND to a look-alike (density's `pgup` lambda) is still caught.
    ws.do(
        "/import pymol;"
        "cmd.key_mappings.clear();cmd.key_mappings.update(pymol._p10_keys);"
        "print('%sB', sorted(k for k in set(cmd.key_mappings) | set(pymol._p10_keys) "
        "if cmd.key_mappings.get(k) is not pymol._p10_keys.get(k)), "
        "len(cmd.key_mappings))" % tag
    )
    left = _tagged(bridge, tag + "B").split(tag + "B", 1)[1].strip()
    assert left == "[] %d" % size_before, (left, size_before)
    ws.do("/cmd.set_wizard_stack([])")
    assert ws.call("wizards.probe")["depth"] == 0
    ws.call("unpick")
    if scheme_before == 0:
        # `cleanup.py:65`, `charge.py:50` and friends call `cmd.edit_mode()` in
        # their constructors; putting it back is not optional in a shared
        # process (PICKING NEEDS THE EDITOR OFF).
        ws.call("edit_mode", 0)
    for name, value in before.items():
        if ws.call("cmd.get", name) != value:
            ws.call("set", name, value, quiet=1)
    for name in set(ws.call("get_names", "all", 0) or ()) - names_before:
        ws.call("delete", name)
    assert set(ws.call("get_names", "all", 0) or ()) == names_before
    after = {name: ws.call("cmd.get", name) for name in _WIZARD_GLOBALS}
    assert after == before, {
        name: (before[name], after[name]) for name in before if before[name] != after[name]
    }
    assert ws.call("get_editor_scheme") == scheme_before


# ---------------------------------------------------------------------------
# ROW 108: the catalogue, counted exactly
# ---------------------------------------------------------------------------

#: MEASURED over the socket on this build -- one entry per ``.py`` in
#: ``modules/pymol/wizard/`` that does not start with ``_``.
_CATALOGUE = (
    "annotation",
    "appearance",
    "benchmark",
    "box",
    "charge",
    "cleanup",
    "command",
    "demo",
    "density",
    "distance",
    "dragging",
    "filter",
    "label",
    "measurement",
    "message",
    "mutagenesis",
    "nucmutagenesis",
    "openvr",
    "pair_fit",
    "pseudoatom",
    "renaming",
    "sculpting",
    "security",
    "stereodemo",
    "toggle",
)

#: The ONE name that must not be launched inside a suite that shares one PyMOL
#: process.  ``test_p9_gui.py::test_stereodemo_is_the_one_skip_that_is_justified``
#: proves the reason off the class object in the running engine:
#: ``Stereodemo.__init__`` calls ``full_screen``/``stereo``/``launch`` and
#: ``Stereodemo.launch`` calls ``cmd.delete`` with ``'all'``.
_JUSTIFIED = ("stereodemo",)


def test_the_catalogue_is_exactly_twenty_five_entries(ws: Any) -> None:
    """The pin the wave-9 audit asked for: ``==``, not ``>=``.

    ``>= 24`` could not have caught the drift it claimed to guard (25 satisfies
    it, and so would 26).  This asserts the exact length AND the exact name set
    AND that the set is what the wizard package directory holds, so a wizard
    added, removed or renamed upstream fails here loudly.
    """
    catalog = ws.call("wizards.catalog")
    names = tuple(sorted(entry["name"] for entry in catalog["wizards"]))

    assert len(catalog["wizards"]) == 25
    assert names == _CATALOGUE

    # every entry is statically launchable: module imports and the class exists
    assert [entry for entry in catalog["wizards"] if not entry["available"]] == []
    assert {entry["cls"] for entry in catalog["wizards"]} == {
        name.capitalize() for name in _CATALOGUE
    }
    assert catalog["aliases"] == {"distance": "measurement"}


def test_the_catalogue_is_the_wizard_package_directory(ws: Any, bridge: Any) -> None:
    """...and the length is DERIVED, not typed: it is `len(os.listdir())`.

    ``catalog()`` unions ``BUNDLED_WIZARDS`` with the package directory
    (``panels/wizards.py:746-753``), so a hardcoded 25 in the test could agree
    with a hardcoded 25 in the bridge and both be wrong.  This reads the
    directory in the ENGINE and compares.
    """
    ws.do(
        "/import os, pymol.wizard as w;"
        "print('P10DIR', sorted(f[:-3] for d in w.__path__ for f in os.listdir(d) "
        "if f.endswith('.py') and not f.startswith('_')))"
    )
    # SKIP THE ECHO: `cmd.do` prints the command line first and it contains the tag.
    line = next(
        text
        for text in reversed(bridge.wait_for_feedback("P10DIR"))
        if "P10DIR [" in text and not text.lstrip().startswith("PyMOL>")
    )
    on_disk = sorted(ast.literal_eval(line.split("P10DIR", 1)[1].strip()))
    assert tuple(on_disk) == _CATALOGUE
    assert len(on_disk) == 25


def test_every_catalogued_wizard_is_walked_or_refused_or_justified(
    ws: Any, bridge: Any, wizard_guard: Any
) -> None:
    """The accounting, computed over the WHOLE catalogue in one place.

    Waves 8 and 9 covered the same ground across two files with a hardcoded
    skip list in between, and the arithmetic that joined them ("24 of 24") was
    wrong.  Here there is no skip list except the one justified name, and the
    three buckets are asserted to PARTITION the catalogue: nothing can be
    silently dropped, because ``walked | refused | justified`` must equal the
    catalogue and the counts are exact.
    """
    names = sorted(entry["name"] for entry in ws.call("wizards.catalog")["wizards"])
    assert len(names) == 25

    walked: Dict[str, int] = {}
    refused: Dict[str, str] = {}
    popups: Dict[str, int] = {}

    for name in names:
        if name in _JUSTIFIED:
            continue
        launched = ws.call_reply("wizards.launch", name)
        if launched["t"] != "ok" or launched["result"].get("depth", 0) == 0:
            error = launched.get("error") or {}
            refused[name] = str(error.get("message", error))[:160]
            continue
        snapshot = ws.call("wizards.snapshot")
        assert snapshot["cls"], (name, snapshot)
        assert isinstance(snapshot["eventMask"], int), (name, snapshot)
        for row in snapshot["panel"]:
            assert row["type"] in (0, 1, 2, 3), (name, row)
            assert isinstance(row["text"], str), (name, row)
            assert isinstance(row["code"], str), (name, row)
        rows = [row for row in snapshot["panel"] if row["type"] == 3]
        for row in rows:
            result = ws.call("wizards.menu", row["code"])
            assert result["items"] is not None, (name, row, result.get("error"))
            for item in result["items"]:
                assert item["code"] in (0, 1, 2), (name, row, item)
                assert isinstance(item["text"], str), (name, row, item)
                assert isinstance(item.get("command", ""), str), (name, row, item)
        walked[name] = len(snapshot["panel"])
        popups[name] = len(rows)
        ws.call("wizards.dismiss", all=True)

    print("P10WALK rows=%r" % (walked,))
    print("P10WALK popups=%r" % (popups,))
    print("P10WALK refused=%r" % (refused,))

    assert set(walked) | set(refused) | set(_JUSTIFIED) == set(names)
    assert not (set(walked) & set(refused))
    assert set(refused) == {"cleanup", "renaming"}, refused
    assert "szybki" in refused["cleanup"], refused
    assert "old_name" in refused["renaming"], refused
    assert len(walked) == 22, sorted(walked)
    assert len(walked) + len(refused) + len(_JUSTIFIED) == 25

    # WHAT THE WALK LEAVES BEHIND, measured rather than assumed -- and the
    # reason `wizard_guard` restores `cmd.key_mappings` wholesale.  `density`
    # binds pgup/pgdn to lambdas (`density.py:246-247`) and its `cleanup()`
    # cannot unbind them: `set_key('pgup', None)` is the DECORATOR form
    # (`controlling.py:766-770`), so the dead lambda survives the wizard and
    # shadows PyMOL's own `scene action=previous` binding.  Before the guard
    # puts the table back, both keys are callables and not command strings.
    ws.do(
        "/print('P10LEAK', [(k, isinstance(cmd.key_mappings.get(k, (None,))[0], str)) "
        "for k in ('pgup', 'pgdn')])"
    )
    assert _tagged(bridge, "P10LEAK").split("P10LEAK", 1)[1].strip() == (
        "[('pgup', False), ('pgdn', False)]"
    )


# ---------------------------------------------------------------------------
# ROW 371: the cleanup/szybki wizard, with a stub that honours the contract
# ---------------------------------------------------------------------------

#: What `auto_configure` (`wizard/cleanup.py:13-34`) looks for and what `run()`
#: (`:104`) shells out to: `$OE_DIR/bin/szybki -i ligand_inp.mol -o
#: ligand_out.mol`, writing an MDL MOL file the wizard then loads.  This stub
#: perturbs ONE atom by exactly +1.0 A in x and copies everything else, which
#: makes the round trip verifiable in a way a rigid transform would not be:
#: `fit(matchmaker=2)` removes rigid motion, so only the INTERNAL change
#: survives -- and internal distances are invariant under that fit.
_STUB_SZYBKI = '''#!/usr/bin/env python3
"""Stand-in for OpenEye szybki: same argv, same file contract, no chemistry."""
import sys

argv = sys.argv[1:]
inp = argv[argv.index('-i') + 1]
out = argv[argv.index('-o') + 1]
with open(inp) as handle:
    lines = handle.read().splitlines(True)
# MDL MOL V2000: line 3 is the counts line, the atom block starts at line 4 and
# each atom line is %10.4f x, y, z followed by the element.
first_atom = lines[4]
lines[4] = '%10.4f%s' % (float(first_atom[0:10]) + 1.0, first_atom[10:])
with open(out, 'w') as handle:
    handle.write(''.join(lines))
with open('szybki_argv.txt', 'w') as handle:
    handle.write(' '.join(sys.argv))
'''

#: The ligand the wizard operates on.  10 atoms, no file I/O, deterministic.
_LIGAND = "p10cleanup_lig"


@pytest.fixture
def szybki(ws: Any, wizard_guard: Any):
    """A fake `$OE_DIR` and a scratch cwd, both removed again.

    NOTHING here is left behind: `run()` writes `ligand_inp.mol` and
    `ligand_out.mol` into the PROCESS cwd, so the cwd moves to a temp directory
    for the duration and is asserted back afterwards.  `$OE_DIR` is read fresh
    by `auto_configure` on every construction, so removing it restores the
    machine's real state -- the refusal test above still refuses.
    """
    oe_dir = tempfile.mkdtemp(prefix="p10oe-")
    work = tempfile.mkdtemp(prefix="p10work-")
    os.makedirs(os.path.join(oe_dir, "bin"))
    exe = os.path.join(oe_dir, "bin", "szybki")
    with open(exe, "w") as handle:
        handle.write(_STUB_SZYBKI)
    os.chmod(exe, os.stat(exe).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    cwd = os.getcwd()
    os.environ["OE_DIR"] = oe_dir
    os.chdir(work)
    ws.call("fragment", "ala", _LIGAND)
    try:
        yield {"oe_dir": oe_dir, "exe": exe, "work": work}
    finally:
        os.chdir(cwd)
        os.environ.pop("OE_DIR", None)
        shutil.rmtree(oe_dir, ignore_errors=True)
        shutil.rmtree(work, ignore_errors=True)
    assert os.getcwd() == cwd
    assert "OE_DIR" not in os.environ
    assert not os.path.exists(exe)


def coords(ws: Any, name: str) -> List[List[float]]:
    return [atom["coord"] for atom in ws.call("get_model", name)["atom"]]


def distance(a: List[float], b: List[float]) -> float:
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def test_cleanup_refuses_to_construct_without_openeye_and_says_so_verbatim(
    ws: Any,
) -> None:
    """The machine's real state, re-measured: no `$OE_DIR`, no wizard.

    `cleanup.py:52-54` raises `CmdException` from `__init__`, and
    `panels/wizards.py:691-705` deliberately does NOT swallow it, so the client
    gets the engine's own sentence and an unchanged stack.  Note the
    catalogue's `available` is a STATIC check (module + class) and says True --
    this failure is only knowable by launching.
    """
    assert "OE_DIR" not in os.environ and "OEDIR" not in os.environ
    depth_before = ws.call("wizards.probe")["depth"]

    reply = ws.call_reply("wizards.launch", "cleanup")

    assert reply["t"] == "err", reply
    assert reply["error"]["kind"] == "CmdException", reply
    assert reply["error"]["message"] == (
        ' Error: cannot find "szybki" executable, please set OE_DIR '
        "environment variable"
    ), reply
    assert ws.call("wizards.probe")["depth"] == depth_before

    entry = next(
        item
        for item in ws.call("wizards.catalog")["wizards"]
        if item["name"] == "cleanup"
    )
    assert entry["available"] is True and entry["note"] == ""


def test_cleanup_renders_its_seven_rows(ws: Any, szybki: Any) -> None:
    """ROW 371's panel, seen for the first time on this machine.

    `cleanup.py:126-137`: title, Run, Undo, Redo, the Ligand popup whose label
    carries the `\\999`/`\\000` colour markup, Refresh, Done -- 7 rows, and the
    codes are the exact command strings the client sends back untouched.
    """
    assert ws.call("wizards.launch", "cleanup")["cls"] == "Cleanup"
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_ligand("%s")' % _LIGAND)
    snapshot = ws.call("wizards.snapshot")

    assert [(row["type"], row["text"], row["code"]) for row in snapshot["panel"]] == [
        (1, "Cleanup", ""),
        (2, "Run", "cmd.get_wizard().run()"),
        (2, "Undo", "cmd.get_wizard().undo()"),
        (2, "Redo", "cmd.get_wizard().redo()"),
        (3, "\\999Ligand:\\000 " + _LIGAND, "ligand"),
        (2, "Refresh", "cmd.get_wizard().update()"),
        (2, "Done", "cmd.set_wizard()"),
    ]
    assert [row["kind"] for row in snapshot["panel"]] == [
        "text", "button", "button", "button", "popup", "button", "button",
    ]
    # default mask, pick|select -- `do_pick` is how a ligand gets adopted
    assert snapshot["eventMask"] == 3
    assert "do_pick" in snapshot["methods"]
    assert snapshot["errors"] == []
    # `get_prompt` appends `self.message`, which is `[]` and not None
    # (`cleanup.py:62,156-157`), so the prompt is the string '[]' -- a real
    # quirk of this wizard, recorded rather than smoothed over.
    assert snapshot["prompt"] == ["[]"]

    menu = ws.call("wizards.menu", "ligand")
    assert menu["error"] is None
    assert menu["items"][0] == {"code": 2, "kind": "title", "text": "Ligand"}
    assert {
        "code": 1,
        "kind": "item",
        "text": _LIGAND,
        "command": 'cmd.get_wizard().set_ligand("%s")' % _LIGAND,
    } in menu["items"]


def test_cleanup_run_drives_the_whole_szybki_round_trip(ws: Any, szybki: Any) -> None:
    """`run()` (`cleanup.py:88-116`), executed by pressing the Run row's code.

    Everything the row promises, measured: the undo copy, the MOL written and
    the MOL read back, the exact command line handed to `cmd.system`, the
    temporary object deleted again -- and, the point of the whole wizard, the
    ligand's coordinates UPDATED from the output.

    The check on those coordinates is an INVARIANT, not a guess.  `run()` fits
    the szybki output back onto the ligand (`fit(matchmaker=2)`) before copying
    it over, and a rigid fit cannot change internal geometry -- so whatever the
    stub did to the molecule's SHAPE must arrive intact, and all 45 pairwise
    distances must equal the ones in the file the stub wrote.
    """
    ws.call("wizards.launch", "cleanup")
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_ligand("%s")' % _LIGAND)
    before = coords(ws, _LIGAND)
    assert len(before) == 10

    # what the stub will write: +1.0 A on the first atom's x, the rest copied
    target = [[before[0][0] + 1.0, before[0][1], before[0][2]]] + before[1:]
    # MEASURED on `fragment ala`: that displacement shortens the 1-2 distance
    # from 1.4599 A to 1.3339 A, so the shape really is different afterwards.
    assert distance(before[0], before[1]) == pytest.approx(1.4599, abs=5e-4)
    assert distance(target[0], target[1]) == pytest.approx(1.3339, abs=5e-4)

    ws.call("wizards.exec_code", "cmd.get_wizard().run()")

    work = szybki["work"]
    assert sorted(os.listdir(work)) == [
        "ligand_inp.mol",
        "ligand_out.mol",
        "szybki_argv.txt",
    ]
    with open(os.path.join(work, "szybki_argv.txt")) as handle:
        assert handle.read() == "%s -i ligand_inp.mol -o ligand_out.mol" % szybki["exe"]

    names = ws.call("get_names", "all", 0)
    assert "_w_cleanup_undo" in names  # save_undo(), `cleanup.py:67-70`
    assert "_cleanup_tmp_obj" not in names  # deleted again, `:114`

    after = coords(ws, _LIGAND)
    assert len(after) == 10
    assert after != before
    assert coords(ws, "_w_cleanup_undo") == before  # the undo copy is pre-run

    # THE INVARIANT: all 45 pairwise distances match the file the stub wrote.
    # (MOL is written to 4 decimals, so the bound is file precision, not a
    # fudge factor; the deviation actually measured is printed below.)
    worst = max(
        abs(distance(after[i], after[j]) - distance(target[i], target[j]))
        for i in range(10)
        for j in range(i + 1, 10)
    )
    print("P10CLEANUP worst pairwise deviation = %.9f A" % worst)
    assert worst < 1e-5, worst

    # ...and the ligand really did move in the lab frame: the fit put the
    # perturbed atom 0.83 A from where it started (measured), which is the
    # residue of a 1.0 A displacement after the rigid superposition.
    assert distance(after[0], before[0]) == pytest.approx(0.83, abs=0.02)
    assert distance(after[0], after[1]) == pytest.approx(1.3339, abs=1e-3)


def test_cleanup_undo_and_redo_are_object_copies(ws: Any, szybki: Any) -> None:
    """`undo`/`redo` (`cleanup.py:72-86`) swap `_w_cleanup_undo`/`_w_cleanup_redo`.

    They are not a coordinate stack: they are whole-object copies made with
    `create`/`set_name`, so undo must restore the pre-run coordinates EXACTLY,
    not approximately.
    """
    ws.call("wizards.launch", "cleanup")
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_ligand("%s")' % _LIGAND)
    before = coords(ws, _LIGAND)

    ws.call("wizards.exec_code", "cmd.get_wizard().run()")
    cleaned = coords(ws, _LIGAND)
    assert cleaned != before

    ws.call("wizards.exec_code", "cmd.get_wizard().undo()")
    assert coords(ws, _LIGAND) == before
    assert coords(ws, "_w_cleanup_redo") == cleaned

    ws.call("wizards.exec_code", "cmd.get_wizard().redo()")
    assert coords(ws, _LIGAND) == cleaned
    assert coords(ws, "_w_cleanup_undo") == before

    # Done/dismiss runs `cleanup()` (`:143-146`), which deletes both copies
    ws.call("wizards.dismiss")
    names = ws.call("get_names", "all", 0)
    assert "_w_cleanup_undo" not in names and "_w_cleanup_redo" not in names


def test_cleanup_do_pick_adopts_the_picked_object_as_the_ligand(
    ws: Any, szybki: Any
) -> None:
    """`do_pick` (`cleanup.py:164-168`) -- the only way to choose a ligand
    without the popup, and the reason the mask is pick|select.

    The adoption is visible in the PANEL, because the Ligand row's label is
    built from `self.ligand`; no attribute read is needed (and none is
    possible: the dispatcher invokes callables only).
    """
    ws.call("wizards.launch", "cleanup")
    ws.call("wizards.exec_code", 'cmd.get_wizard().set_ligand("")')
    assert ws.call("wizards.snapshot")["panel"][4]["text"] == "\\999Ligand:\\000 "
    assert ws.call("wizards.snapshot")["prompt"] == ["Please pick a ligand...", "[]"]

    result = ws.call("wizards.event", "pick", selection="%s and name CA" % _LIGAND)
    assert result["dispatched"] is True
    assert [call["method"] for call in result["calls"]] == ["do_pick_state", "do_pick"]
    assert [call["error"] for call in result["calls"]] == [None, None]

    assert ws.call("wizards.snapshot")["panel"][4]["text"] == (
        "\\999Ligand:\\000 " + _LIGAND
    )
