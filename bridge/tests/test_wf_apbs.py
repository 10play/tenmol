"""Parity area 10 — the APBS dialog deferral, and child stdout -> ``feedback``.

Two inventory rows, and they are not the same kind of row.

**"APBS dialog — 5 stacked pages, 86 widgets"** is a *deferral*, so what has to
be tested is the deferral's premise, not the dialog.  The premise is three
claims: the .ui really is that big, the plugin really is still discoverable,
and the two binaries it shells out to really are absent — plus a fourth the row
does not make and should: the thing the panel tells the user to do instead has
to actually work.

**"Subprocess stdout/stderr into the feedback topic"** is a *defect*, and it is
the reason the first row's dialog would be half-mute if it were ported today.
``data/startup/apbs_gui/electrostatics.py:156`` is::

    p = subprocess.Popen([exe, infile], cwd=tempdir)

with no ``stdout=``, so the child inherits the **server's** file descriptors.
``pcatch`` (``layer1/P.cpp:2662-2674``) is a Python object installed as
``sys.stdout``; it has no descriptor, so nothing a child writes can reach it.
:mod:`tenmol_bridge.subproc` is the fix and this file is its proof.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_apbs.py -q

SHARED-STATE NOTE.  ``util.protein_vacuum_esp`` creates three objects, disables
its input and drives the editor (``chempy.champ.assign.missing_c_termini`` does
``cmd.edit`` / ``cmd.attach`` / ``cmd.unpick``), which also leaves
``_pkbase*``/``_pkfrag*`` behind.  The whole suite shares one PyMOL, so the
``scratch`` fixture below records the name list and ``button_mode`` before the
test and puts both back afterwards.  Nothing here is printed, either: this
suite runs with ``-s`` so a test's own ``print`` goes through ``pcatch`` into
the very feedback ring these tests assert on.
"""

from __future__ import annotations

import os
import shutil
import sys
import time
# The .ui parsed below is a file from this repository, not client input.
import xml.etree.ElementTree as ET  # noqa: S405
from typing import Any, Dict, List

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APBS_UI = os.path.join(REPO, "data", "startup", "apbs_gui", "apbs.ui")

#: A needle must never appear in the command line that produces it, because the
#: ``PyMOL>`` echo of that command line lands on the feedback topic too and
#: would satisfy a naive ``in`` check.  Every child below therefore *computes*
#: its needle from two halves.
HALF = "ZWFA"


@pytest.fixture
def scratch(ws: WSClient):
    """Undo every global this test disturbs: names, the editor, the CAMERA.

    The camera one was learned the hard way and is worth spelling out.
    ``util.protein_vacuum_esp`` calls ``cmd.create``, whose ``zoom`` default is
    ``-1`` = "obey ``auto_zoom``", which is on — so simply running it MOVES THE
    VIEW for every later test in the process.  Measured: with the restore
    below removed, ``test_wf_wizards.py::
    test_auto_position_is_computed_from_field_of_view_and_get_view`` failed
    with "Mismatched elements: 1 / 3" while passing on its own.  That looked
    exactly like a product bug in the wizard code and was not.
    """
    before_names = set(ws.call("cmd.get_names", "all"))
    before_mode = ws.call("cmd.get_setting_int", "button_mode")
    before_view = ws.call("cmd.get_view")
    try:
        yield
    finally:
        ws.call("cmd.unpick")
        for name in ws.call("cmd.get_names", "all"):
            if name not in before_names:
                ws.call("cmd.delete", name)
        if ws.call("cmd.get_setting_int", "button_mode") != before_mode:
            ws.call("cmd.set", "button_mode", before_mode)
        ws.call("cmd.set_view", before_view)


def child(ws: WSClient, code: str, wire_timeout: float = 60.0, **kwargs: Any) -> Dict[str, Any]:
    """Run a snippet of Python as a real child process through the bridge.

    Not ``ws.call``: its own ``timeout=`` is the *socket* deadline, so passing
    ``subproc.execute``'s ``timeout`` through it would silently be swallowed by
    the test client and never reach the runner.  Cost me one confused failure.
    """
    reply = ws.request(
        t="call",
        fn="subproc.execute",
        args=[[sys.executable, "-c", code]],
        kwargs=kwargs,
        timeout=wire_timeout,
    )
    assert reply["t"] == "ok", reply
    return reply["result"]


def wait_for(ws: WSClient, bridge, needle: str, timeout: float = 6.0) -> List[str]:
    """Feedback lines containing ``needle``, EXCLUDING the ``PyMOL>`` echo."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        hits = [
            line
            for line in bridge.feedback_lines()
            if needle in line and not line.lstrip().startswith("PyMOL>")
        ]
        if hits:
            return hits
        time.sleep(0.05)
    return []


# =====================================================================
# ROW: "APBS dialog — 5 stacked pages, 86 widgets" (the deferral premise)
# =====================================================================


def test_the_ui_file_is_the_size_the_deferral_claims() -> None:
    """Pin the numbers the row argues from, and correct the one that is wrong.

    MEASURED from ``apbs.ui`` itself: 1,405 lines and 86 ``<widget>`` elements,
    both exactly as the row states.  The row's "5 stacked pages" is **not**
    right — the ``QStackedWidget`` has SEVEN pages, one per entry of the
    ``prep_method`` combo (pdb2pqr, prepwizard, protein_assign_charges_and_radii
    and four coarse-grained charge models).  Two of the seven are the ones that
    need an external program; five need nothing at all, which is exactly why
    the panel offers the in-PyMOL route.

    This is a cheap, permanent tripwire: the day someone ports a page, the
    counts move and the row has to be revisited rather than silently drifting.
    """
    assert os.path.exists(APBS_UI), APBS_UI
    with open(APBS_UI, encoding="utf-8") as handle:
        assert len(handle.readlines()) == 1405

    root = ET.parse(APBS_UI).getroot()
    widgets = list(root.iter("widget"))
    assert len(widgets) == 86, "the row's widget count moved"

    stacks = [w for w in widgets if w.get("class") == "QStackedWidget"]
    assert len(stacks) == 1
    pages = [child for child in stacks[0] if child.tag == "widget"]
    assert len(pages) == 7, "the row says 5; it is 7, one per prep method"

    tabs = [w for w in widgets if w.get("class") == "QTabWidget"]
    titles = [
        page.findtext("attribute[@name='title']/string")
        for page in tabs[0]
        if page.tag == "widget"
    ]
    assert titles == ["Main", "APBS Template", "Advanced Configuration"]

    buttons = {w.get("name") for w in widgets if w.get("class") == "QPushButton"}
    # "four collapsible option areas" from the row = these four reveals.
    assert {
        "optbutton_prepare",
        "optbutton_apbs",
        "optbutton_surface",
        "optbutton_other",
    } <= buttons
    # "OK/Reset/Load/Register" from the row.  Note the on-screen labels are
    # "Run" / "Reset" / "Browse..." / "Register APBS Use".
    assert {"button_ok", "button_reset", "button_load", "button_register"} <= buttons


def test_the_plugin_file_is_still_discoverable(ws: WSClient) -> None:
    """The stub's whole job: the feature must not vanish silently.

    ``plugins.findPlugins`` is a filesystem scan, so this stays true without a
    Qt plugin manager.  MEASURED here: two plugins on the startup path,
    ``apbs_gui`` and ``lightingsettings_gui``.
    """
    paths = ws.call("plugins.get_startup_path")
    # ONE argument, which is itself the list of directories.  `WSClient.call`
    # takes *args, so `call(fn, [paths])` would pass a list-of-lists and
    # `findPlugins` answers `TypeError: stat: path should be string ... not
    # list`.  `Session.call(fn, args)` in the web client takes the array form,
    # which is why `ApbsPanel` writes it the other way round.
    found = ws.call("plugins.findPlugins", paths)
    assert "apbs_gui" in found, found
    assert found["apbs_gui"].endswith(os.path.join("apbs_gui", "__init__.py"))


def test_the_plugin_is_on_the_path_but_has_NOT_been_imported(
    ws: WSClient, bridge
) -> None:
    """Correction to a claim the panel used to make.

    The panel said "It still autoloads into the Python process, so nothing
    about your PyMOL install has changed."  Measured over the socket, that is
    false.  Autoload runs from ``pymol.plugins.initialize()``, which only the
    Qt front end calls, and ``__init_plugin__`` ends in ``addmenuitemqt``
    (``data/startup/apbs_gui/__init__.py:448-450``) — a Qt entry point that
    cannot run here.  Measured in a fresh bridge: ``plugins.plugins`` is empty,
    ``plugins.autoload`` is empty, and ``apbs_gui`` is not in ``sys.modules``.

    WHAT IS ASSERTED IS NOT THE EMPTY REGISTRY.  The whole suite shares one
    PyMOL, and ``test_wf_plugins.py`` (the Plugin Manager panel) calls
    ``plugins.initialize(-2)``, which REGISTERS every plugin — so by the time
    this file runs in a different order, ``plugins.plugins`` may well hold
    ``apbs_gui``.  That is not the panel's claim.  The claim is that no plugin
    *code* has run, which survives registration: ``initialize(-2)`` only
    scans, so ``PluginInfo.loaded`` stays False and the module is still not in
    ``sys.modules``.  Asserting the registry size instead would have made this
    test pass or fail on alphabetical file order.

    Read by PRINTING, because the dispatcher only invokes callables: a bare
    attribute like ``plugins.autoload`` answers "is not callable".  One line,
    not a block — ``cmd.do`` executes a line at a time.  The ``PyMOL>`` echo is
    skipped: PyMOL prints the command before running it.
    """
    tag = HALF + "_LOAD"
    ws.do(
        "import sys; from pymol import plugins; "
        "print('%s', 'apbs_gui' in sys.modules, "
        "'pmg_tk.startup.apbs_gui' in sys.modules, "
        "getattr(plugins.plugins.get('apbs_gui'), 'loaded', 'unregistered'))" % tag
    )
    hits = wait_for(ws, bridge, tag)
    assert hits, "no output"
    fields = hits[-1].split()
    assert fields[:3] == [tag, "False", "False"], hits[-1]
    assert fields[3] in ("unregistered", "False"), hits[-1]


def test_which_answers_for_the_two_binaries_the_dialog_needs(ws: WSClient) -> None:
    """The deferral's load-bearing fact, asked instead of asserted.

    MEASURED on this machine: ``subproc.which('apbs')`` -> ``None``,
    ``subproc.which('pdb2pqr')`` -> ``None``, and
    ``cmd.exp_path('$SCHRODINGER/utilities/apbs')`` comes back unexpanded
    (``$SCHRODINGER`` is unset), so the plugin's fallback misses too.  That is
    what makes "porting 86 widgets now is the wrong investment" true rather
    than merely plausible.

    The *assertion* is machine-independent on purpose — a CI box with apbs
    installed must not fail this file.  What is pinned is that the bridge's
    answer is the same answer ``shutil.which`` gives in this very process, and
    that the search order matches the plugin's own
    (``electrostatics.py:49-57``, ``__init__.py:224-231``).
    """
    for name in ("apbs", "pdb2pqr", "pdb2pqr30", "pdb2pqr_cli", "sh"):
        assert ws.call("subproc.which", name) == shutil.which(name), name

    # `sh` is the control: if `which` always answered None the assertions above
    # would be vacuous.
    assert ws.call("subproc.which", "sh")

    schrodinger = ws.call("cmd.exp_path", "$SCHRODINGER/utilities/apbs")
    assert ws.call("subproc.which", schrodinger) == shutil.which(schrodinger)


def test_the_in_pymol_route_the_panel_recommends_actually_runs(
    ws: WSClient, bridge, scratch
) -> None:
    """``util.protein_vacuum_esp`` is not a placeholder — it works headless.

    The panel sends the user here when ``apbs`` is missing, so "it works" has
    to be a test and not a hope.  MEASURED: on a plain ``cmd.fragment('ala')``
    it produces ``<name>_e_chg`` (``object:molecule``), ``<name>_e_map``
    (``object:map``) and ``<name>_e_pot`` (``object:ramp``), and sets
    ``surface_color`` on the new object to the ramp.

    It is vacuum Coulomb (``cmd.map_new(..., "coulomb_local", ...)``,
    ``modules/pymol/util.py:418-419``), NOT Poisson-Boltzmann — no solvent
    screening.  The panel says so; this only pins that it runs.
    """
    name = "wfapbs_ala"
    ws.subscribe("feedback")
    ws.call("cmd.fragment", "ala", name)
    ws.call("util.protein_vacuum_esp", name)

    types = {n: ws.call("cmd.get_type", n) for n in ws.call("cmd.get_names", "all")}
    assert types.get(name + "_e_chg") == "object:molecule", types
    assert types.get(name + "_e_map") == "object:map", types
    assert types.get(name + "_e_pot") == "object:ramp", types
    assert ws.call("cmd.get", "surface_color", name + "_e_chg") == name + "_e_pot"

    # WITHDRAWN CLAIM, worth recording.  The subprocess row says "B9's
    # `protein_vacuum_esp` diagnostics need the same channel".  They do not:
    # `protein_vacuum_esp` shells out to nothing at all — it is
    # `cmd.map_new(..., "coulomb_local", ...)` in C — and its progress lines are
    # ordinary Python `print`s, which already reach the browser through pcatch.
    # Measured here rather than argued: the line below arrives on the feedback
    # topic with no new machinery.
    assert wait_for(ws, bridge, "Calculating electrostatic potential")


# =====================================================================
# ROW: "Subprocess stdout/stderr into the feedback topic"
# =====================================================================


def test_a_bare_inheriting_subprocess_never_reaches_the_browser(
    ws: WSClient, bridge
) -> None:
    """THE DEFECT, measured.  This is a characterization test.

    A child launched the way ``electrostatics.py:156`` launches ``apbs``
    inherits fd 1/2 of the *server*.  Its output shows up on the terminal the
    bridge was started from and NOWHERE on the wire.

    If this test ever fails it does not mean something broke — it means someone
    added a process-wide fd tee, and the inventory row plus
    :mod:`tenmol_bridge.subproc`'s "why not a global tee" section need
    revisiting (the hazard there is double-reporting every ordinary console
    line, because ``OrthoNewLine`` already ``printf``s each one to fd 1).
    """
    needle = HALF + "_ESCAPES"
    ws.subscribe("feedback")
    ws.do(
        "import subprocess, sys; subprocess.call([sys.executable, '-c', "
        '"print(\'%s\' + \'%s\')"])' % (HALF, "_ESCAPES")
    )
    # Give the 10 Hz status poller ten chances to prove us wrong.
    assert wait_for(ws, bridge, needle, timeout=2.0) == []
    ws.pump_frames(0.3)
    escaped = [
        line
        for line in ws.feedback
        if needle in line and not line.lstrip().startswith("PyMOL>")
    ]
    assert escaped == [], escaped


def test_subproc_execute_puts_child_output_on_the_feedback_topic(
    ws: WSClient, bridge
) -> None:
    """THE FIX, end to end over a real socket.

    Both halves are asserted, because they can fail independently: the
    status-poller ring (what a late subscriber gets replayed) and the frames
    actually pushed to this client.
    """
    needle = HALF + "_DELIVERED"
    ws.subscribe("feedback")
    result = child(ws, "print('%s' + '%s')" % (HALF, "_DELIVERED"))

    assert result["returncode"] == 0
    assert result["lines"] == [needle]
    assert result["timedOut"] is False
    assert wait_for(ws, bridge, needle), bridge.feedback_lines()[-10:]

    ws.pump_frames(1.5)
    assert [line for line in ws.feedback if needle in line], ws.feedback[-10:]


def test_stderr_is_merged_into_the_same_ordered_stream(ws: WSClient, bridge) -> None:
    """``stderr=STDOUT``, deliberately.

    Two pipes would need two readers and the interleaving — which is the only
    thing that makes a compiler-style log readable — would be lost.  PyMOL's
    console has no severity channel to carry the distinction anyway:
    ``test_feedback_path.py`` measures ``colorprinting.error`` arriving
    indistinguishable from a plain ``print``.
    """
    ws.subscribe("feedback")
    result = child(
        ws,
        "import sys\n"
        "sys.stdout.write('%s' + '_ONE\\n'); sys.stdout.flush()\n"
        "sys.stderr.write('%s' + '_TWO\\n'); sys.stderr.flush()\n"
        "sys.stdout.write('%s' + '_THREE\\n')" % (HALF, HALF, HALF),
    )
    assert result["lines"] == [HALF + "_ONE", HALF + "_TWO", HALF + "_THREE"]
    assert wait_for(ws, bridge, HALF + "_TWO"), "the stderr line never arrived"


def test_output_arrives_while_the_child_is_still_running(ws: WSClient, bridge) -> None:
    """Streaming, not a dump at the end — the whole point for a long ``apbs``.

    The read loop occupies the engine thread, so no draws happen while a child
    runs; console output flows anyway because the 10 Hz status thread and
    ``cmd._get_feedback()`` are independent of it (they use ``lock_attempt``,
    ``modules/pymol/internal.py:596-606``).

    MEASURED writing this: with a child emitting one line per second for three
    seconds, the first line was on the feedback topic 0.45 s in while the reply
    frame only came back at 3.09 s.  The assertion below is deliberately loose
    (first line strictly before the reply, and before half the run) so it
    cannot flake on a loaded machine, but a change to batch-at-the-end would
    still fail it.
    """
    needle = HALF + "_TICK"
    ws.subscribe("feedback")
    code = (
        "import sys, time\n"
        "for i in range(3):\n"
        "    print('%s' + '_TICK', i); sys.stdout.flush(); time.sleep(1.0)\n" % HALF
    )
    started = time.monotonic()
    msg_id = ws.send(t="call", fn="subproc.execute", args=[[sys.executable, "-u", "-c", code]],
                     kwargs={})
    assert wait_for(ws, bridge, needle, timeout=10.0), "nothing streamed"
    first_line_at = time.monotonic() - started

    reply = ws.wait_reply(msg_id, timeout=30.0)
    replied_at = time.monotonic() - started

    assert reply["t"] == "ok", reply
    assert reply["result"]["lines"] == [needle + " %d" % i for i in range(3)]
    assert first_line_at < replied_at, (first_line_at, replied_at)
    assert first_line_at < replied_at / 2.0, (first_line_at, replied_at)


def test_exit_status_is_reported_not_swallowed(ws: WSClient, bridge) -> None:
    """A non-zero exit is a result, not an exception — unless ``check=True``.

    ``apbs`` uses its exit code as a control channel: ``electrostatics.py``
    retries with a coarser grid on -6/-9 and raises on -15 (SIGTERM).  A runner
    that turned every non-zero into an exception would make that impossible.
    """
    ws.subscribe("feedback")
    result = child(ws, "raise SystemExit(7)")
    assert result["returncode"] == 7
    assert wait_for(ws, bridge, "exited with status 7"), "no diagnostic line"

    failed = ws.call_reply(
        "subproc.execute", [sys.executable, "-c", "raise SystemExit(7)"], check=True
    )
    assert failed["t"] == "err", failed
    assert failed["error"]["type"] == "SubprocessFailed"
    assert failed["error"]["detail"]["returncode"] == 7


def test_a_wedged_child_is_killed_at_the_timeout(ws: WSClient) -> None:
    """A watchdog, not a clock check between lines.

    A silent hung child produces no lines at all, so a deadline tested inside
    the read loop would never be reached.  MEASURED: a 30 s sleeper asked to
    stop after 1.5 s came back at ~1.5 s with ``returncode`` -9 (SIGKILL) and
    ``timedOut`` true.
    """
    started = time.monotonic()
    result = child(ws, "import time; time.sleep(30)", timeout=1.5)
    elapsed = time.monotonic() - started
    assert result["timedOut"] is True
    assert result["returncode"] < 0, result
    assert elapsed < 10.0, elapsed


def test_a_missing_executable_is_a_typed_error_raised_before_the_fork(
    ws: WSClient,
) -> None:
    """``argv[0]`` is resolved with ``shutil.which`` first.

    The user-visible difference: the error names the program they asked for
    (``apbs``) instead of a ``FileNotFoundError`` about ``[Errno 2]`` from
    inside ``subprocess``.  The APBS plugin needs exactly this — the whole
    dialog is gated on two executables that are usually absent.
    """
    reply = ws.call_reply("subproc.execute", ["wfapbs-no-such-program"])
    assert reply["t"] == "err", reply
    assert reply["error"]["type"] == "ExecutableNotFound"
    assert reply["error"]["detail"]["program"] == "wfapbs-no-such-program"


def test_execute_never_goes_through_a_shell(ws: WSClient) -> None:
    """An argv list, always.  ``shell=True`` is not reachable from the wire.

    This is what makes ``subproc.execute`` strictly weaker than ``cmd.system``,
    which the policy already permits after one confirmation.  A shell
    metacharacter is passed to the program as a literal argument and no
    redirection, pipeline or second command happens.
    """
    victim = "/tmp/wfapbs-shell-must-not-run"
    if os.path.exists(victim):
        os.unlink(victim)
    payload = "hello; touch " + victim
    result = ws.call("subproc.execute", ["/bin/echo", payload])
    assert result["lines"] == [payload]
    assert not os.path.exists(victim), "the argument was interpreted by a shell"


def test_execute_is_marked_dangerous_and_says_why(ws: WSClient) -> None:
    """Starting a local program is reported to the client, never hidden."""
    reply = ws.call_reply("subproc.execute", ["/bin/echo", "ok"])
    assert reply["t"] == "ok", reply
    assert reply.get("dangerous") is True, reply


def test_capture_children_rescues_code_that_is_not_ours_to_edit(
    ws: WSClient, bridge
) -> None:
    """The ``electrostatics.py:156`` shape, fixed without touching the plugin.

    ``subprocess.Popen([exe, infile], cwd=tempdir)`` lives in
    ``data/startup/``.  Inside ``capture_children()`` that exact call gets a
    pipe and a drain thread, so its output reaches the browser; a ``Popen``
    that already redirects (``creating.py:104`` to a temp file, ``:215`` via
    ``communicate()``) is left untouched, so the two call sites that were
    already correct do not change behaviour.

    ``cmd.do`` executes ONE LINE AT A TIME — a ``with:`` block over several
    lines raises ``IndentationError`` — hence the explicit
    ``__enter__``/``__exit__``.
    """
    needle = HALF + "_ADOPTED"
    ws.subscribe("feedback")
    ws.do(
        "import subprocess, sys, time; "
        "from tenmol_bridge.subproc import capture_children; "
        "cap = capture_children(); cap.__enter__(); "
        "subprocess.Popen([sys.executable, '-c', "
        "\"print('%s' + '%s')\"]).wait(); "
        "time.sleep(0.4); cap.__exit__(); "
        "print('%s_COUNT', cap.captured)" % (HALF, "_ADOPTED", HALF)
    )
    assert wait_for(ws, bridge, needle), bridge.feedback_lines()[-10:]
    counted = wait_for(ws, bridge, HALF + "_COUNT")
    assert counted and counted[-1].split()[-1] == "1", counted


def test_capture_children_leaves_an_explicit_redirection_alone(ws: WSClient) -> None:
    """The other half of the contract, unit-tested in-process.

    ``creating.py`` pipes on purpose and then reads what it collected.  If
    ``capture_children`` stole those pipes, ``communicate()`` would come back
    empty and pdb2pqr's warnings would disappear — a fix that broke the one
    call site that was already right.
    """
    import subprocess

    from tenmol_bridge.subproc import capture_children

    with capture_children() as cap:
        proc = subprocess.Popen(
            [sys.executable, "-c", "print('kept')"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        out = proc.communicate()[0]
    assert out.strip() == "kept"
    assert cap.captured == 0
    assert subprocess.Popen is not None


# =====================================================================
# the policy grant itself
# =====================================================================


def test_the_grant_does_not_hijack_cmd_run(ws: WSClient) -> None:
    """Why the leaf is ``execute`` and not ``run``.

    ``Policy.check`` looks up ``dangerous`` and ``invalidates`` by the LAST
    dotted segment, process-wide.  A grant declaring ``run`` would have
    rewritten the danger text of ``cmd.run`` (File ▸ Run Script) and given
    every child process ``resync`` invalidation, forcing a full client refresh
    after each one.  Both are silent, so this is worth an assertion.
    """
    from tenmol_bridge.policy import build_policy

    policy = build_policy()
    assert "subproc" in policy.roots, "policy/grants/wp-25-apbs.py did not load"

    run = policy.check("cmd.run")
    assert run.danger_reason == "executes an arbitrary Python file"
    assert run.invalidates == ("resync",)

    execute = policy.check("subproc.execute")
    assert execute.allowed and execute.dangerous
    assert execute.invalidates == ()
    assert execute.needs_confirmation is False

    assert policy.check("subproc.which").allowed
    assert not policy.check("subproc.which").dangerous


def test_the_service_is_addressable_without_editing_a_shared_file() -> None:
    """The seam ``wp-16.py`` established, reused verbatim.

    ``dispatch._ROOT_MODULES`` maps an unlisted root to ``pymol.<root>`` and
    ``dispatch.py`` belongs to WP-02, so the grant file seeds
    ``sys.modules['pymol.subproc']`` instead of editing it.  If WP-02 ever adds
    the entry, this stays true and the seeding becomes redundant rather than
    wrong.
    """
    import tenmol_bridge.subproc as service
    from tenmol_bridge.policy import build_policy

    build_policy()  # loading the grants is what installs the alias
    assert sys.modules.get("pymol.subproc") is service


def test_the_new_module_does_not_open_a_second_feedback_drain() -> None:
    """:mod:`tenmol_bridge.subproc` prints; it must never poll.

    Everything in this file rides the one drain the status thread owns.  A
    module that called ``cmd._get_feedback()`` to "collect" child output would
    steal lines from the real console (plan §1.2) — and a runner that wanted to
    "return what the child printed" is exactly the kind of code that reaches
    for it.

    Uses the shipped lint rather than a substring check: the module's docstring
    discusses the drain at length and has to stay free to do so.
    """
    sys.path.insert(0, os.path.join(REPO, "tools", "parity"))
    import drain_lint

    target = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "tenmol_bridge",
        "subproc.py",
    )
    assert drain_lint.check([target]) == []
    assert "subproc.py" not in drain_lint.EXPECTED_CALL_SITES["_get_feedback"]
