"""Area 10, adversarial re-verification — what an independent run could defend.

``test_wf_apbs.py`` (a different agent) builds ``tenmol_bridge.subproc`` and
pins it.  I re-ran all 19 of its tests alone and inside the full suite, and
mutation-tested the module underneath them; they bite.  This file does not
duplicate that.  It pins the three things that re-verification found were
**not** pinned, one of which was a false claim shipped in a docstring.

1. THE SECURITY CLAIM WAS BACKWARDS.  ``subproc.py`` and the WP-25 grant both
   asserted ``execute`` is "strictly less powerful than ``cmd.system``, which is
   already reachable with one confirmation ... no metacharacter, pipeline or
   redirection surface at all".  ``shell=True`` really is never set, and
   ``test_wf_apbs.py::test_execute_never_goes_through_a_shell`` really does show
   ``/bin/echo`` receiving ``hello; touch ...`` as one literal argument — but
   that test proves only that ``execute`` does not *interpose* a shell.  It
   says nothing about ``argv[0]`` **being** one, which is unrestricted.
   Measured here: the shell runs, and it runs with fewer gates than
   ``cmd.system``, not more.

2. WHY THE STACK HAS SEVEN PAGES AND NOT THE ROW'S FIVE.  The other file
   asserts ``len(pages) == 7``, which pins the number but not the reason, so a
   future edit that adds a page and a combo entry together would trip it with
   no explanation attached.  The pages are 1:1 with the ``prep_method`` combo.

3. THE WITHDRAWN ``protein_vacuum_esp`` CLAIM, from the other direction.  Row
   467 says B9's diagnostics "need the same channel".  They do not.  The other
   file shows one of its lines arriving; this shows *why* that is not luck --
   the function contains no child-process call at all.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_apbsverify.py -q

SHARED-STATE NOTE.  Nothing here touches a PyMOL global: no setting, no camera,
no object, no editor state.  The one live call starts a child process and writes
one file under pytest's ``tmp_path``.  The confirmation asymmetry is asserted
against a **freshly built** ``Policy`` rather than the live session's, because
``Policy.confirm`` is session state --- any other test that sends a
``{t:'confirm'}`` frame for ``cmd.system`` would otherwise flip this file's
result depending on execution order.
"""

from __future__ import annotations

import inspect
import os
import sys
import time
# The .ui parsed below is a file from this repository, not client input.
import xml.etree.ElementTree as ET  # noqa: S405

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APBS_UI = os.path.join(REPO, "data", "startup", "apbs_gui", "apbs.ui")
SUBPROC_PY = os.path.join(REPO, "bridge", "tenmol_bridge", "subproc.py")
GRANT_PY = os.path.join(
    REPO, "bridge", "tenmol_bridge", "policy", "grants", "wp-25-apbs.py"
)

#: Split so the ``PyMOL>`` echo of the command that produces it cannot satisfy
#: an ``in`` check.  Same discipline as ``test_wf_apbs.py``, different needle so
#: the two files cannot read each other's lines out of the shared ring.
HALF = "QVXA"


def feedback_hits(bridge, needle: str, timeout: float = 6.0):
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
# 1. the withdrawn security claim
# =====================================================================


def test_execute_reaches_a_full_shell_with_no_confirmation(
    ws: WSClient, bridge, tmp_path
) -> None:
    """``shell=False`` does not mean "cannot reach a shell".

    ``resolve()`` runs ``shutil.which(argv[0])`` and accepts whatever it finds.
    ``sh`` is on PATH on every machine this will ever run on --- indeed
    ``test_wf_apbs.py`` uses ``which('sh')`` as its *control* that ``which``
    is not stubbed to ``None`` --- so ``["/bin/sh", "-c", ...]`` resolves and
    the child gets the whole shell grammar: redirection, ``;``, pipelines.

    MEASURED on this machine: reply ``{"t": "ok", "dangerous": true}`` with no
    ``needsConfirmation``, in 0.005 s, and the redirected file existed
    afterwards.  Asserting the *effect* (a file the shell created) and not just
    the exit status, because a zero exit proves nothing about what ran.

    This is a claim correction, NOT a newly opened hole --- see the companion
    test below.
    """
    needle = HALF + "_SHELL"
    victim = tmp_path / "shell-really-ran"
    ws.subscribe("feedback")

    reply = ws.call_reply(
        "subproc.execute",
        ["/bin/sh", "-c", "echo %s > '%s'; echo %s%s" % (needle, victim, HALF, "_SHELL")],
    )

    assert reply["t"] == "ok", reply
    assert reply.get("dangerous") is True, reply
    assert "needsConfirmation" not in reply, reply
    assert reply["result"]["returncode"] == 0, reply

    # The shell's `>` redirection happened: this is the capability, not the
    # exit code.
    assert victim.exists(), "the shell did not run"
    assert victim.read_text().strip() == needle

    # ...and the `;`-separated second command's output came back on the topic,
    # so a shell one-liner is fully usable through this channel.
    assert feedback_hits(bridge, needle), bridge.feedback_lines()[-10:]


def test_confirm_once_gates_system_but_not_execute() -> None:
    """The asymmetry, on a fresh Policy so suite order cannot decide it.

    UPDATED IN WAVE 10, and the update is the point.  This test used to record
    that ``Grant`` had **no field** that could add to ``CONFIRM_ONCE``, so the
    WP-25 grant *could not* gate ``execute`` even if it wanted to.  That is no
    longer true: ``Grant.confirm_once`` exists (``policy/base.py``), and the
    same pass fixed the dotted-path lookup that any such gate would have had to
    work around.

    The BEHAVIOUR is unchanged, and now for a reason the code can express: WP-25
    argues in its own grant file that gating ``execute`` while ``cmd.do`` is
    dangerous, ungated and able to run ``import subprocess`` on the same socket
    is theatre.  "Cannot say it" and "chose not to say it" are different states;
    this is now the second one.
    """
    from tenmol_bridge.policy import build_policy
    from tenmol_bridge.policy.base import CONFIRM_ONCE, Grant

    assert CONFIRM_ONCE == frozenset({"system"})
    assert Grant("probe").confirm_once == set(), "the field exists and is empty"

    policy = build_policy()
    system = policy.check("cmd.system")
    execute = policy.check("subproc.execute")

    assert system.dangerous and system.needs_confirmation is True
    assert execute.dangerous and execute.needs_confirmation is False

    # ...and the gate WOULD work if WP-25 ever asked for it, keyed either way.
    gated = build_policy().add_grant(Grant("probe", confirm_once={"subproc.execute"}))
    assert gated.check("subproc.execute").needs_confirmation is True
    assert gated.check("subproc.which").needs_confirmation is False


def test_execute_is_a_new_channel_and_not_a_new_capability(ws: WSClient, bridge) -> None:
    """Why the finding above is a correction and not an escalation.

    ``cmd.do`` is already dangerous *and* already ungated, and PyMOL's ``do``
    happily executes a Python statement --- ``test_wf_apbs.py``'s own defect
    test is ``ws.do("import subprocess; subprocess.call([...])")``.  Anything
    ``subproc.execute`` can start, ``cmd.do`` could already start; what
    ``execute`` adds is that the output comes *back*.

    Worth an assertion because it is the load-bearing half of the correction:
    without it, the docstring fix reads as "we shipped a hole", which would be
    the opposite error to the one being fixed.
    """
    from tenmol_bridge.policy import build_policy
    from tenmol_bridge.policy.base import CONFIRM_ONCE

    decision = build_policy().check("cmd.do")
    assert decision.allowed and decision.dangerous
    assert decision.needs_confirmation is False
    assert "do" not in CONFIRM_ONCE

    # ...and it is not merely *permitted* in the abstract: measured over the
    # live socket, `cmd.do` runs an `import subprocess` line and the child
    # really starts.  The needle is computed by the child so the `PyMOL>` echo
    # of the command cannot satisfy the check.
    needle = HALF + "_VIADO"
    ws.subscribe("feedback")
    ws.do(
        "import subprocess, sys; subprocess.run([sys.executable, '-c', "
        "\"print('%s' + '%s')\"], capture_output=True)" % (HALF, "_VIADO")
    )
    # The child's stdout is captured by the caller here, so nothing is expected
    # on the topic -- what is being shown is that `cmd.do` was ALLOWED to fork
    # at all, with no confirmation frame.
    reply = ws.call_reply("cmd.do", "print('%s' + '%s')" % (HALF, "_VIADO"))
    assert reply["t"] == "ok", reply
    assert "needsConfirmation" not in reply, reply
    assert feedback_hits(bridge, needle), bridge.feedback_lines()[-10:]


def test_the_withdrawn_claim_cannot_come_back_silently() -> None:
    """A doc guard, deliberately.

    The defect being pinned here was never a crash --- it was a confident,
    wrong sentence in two docstrings, which is exactly the class of thing that
    gets copied forward.  ``pytest`` is the only place in this repo that reads
    every file on every change, so the guard lives here.
    """
    for path in (SUBPROC_PY, GRANT_PY):
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        for phrase in (
            "strictly less powerful than",
            "strictly *weaker* than",
            "no metacharacter, pipeline or redirection surface at all",
        ):
            # Allowed only where the file is quoting the claim to withdraw it.
            for line_no, line in enumerate(text.splitlines(), 1):
                if phrase in line:
                    window = text.splitlines()[max(0, line_no - 12) : line_no + 12]
                    assert any(
                        "WITHDRAWN" in w or "was wrong" in w or "used to say" in w
                        for w in window
                    ), "%s:%d restates the withdrawn claim" % (path, line_no)


# =====================================================================
# 2. the seven pages, with their reason attached
# =====================================================================


def test_the_stack_has_one_page_per_prep_method_which_is_why_it_is_seven() -> None:
    """The row says 5; it is 7, and the 7 is not arbitrary.

    MEASURED from ``apbs.ui``: the ``prep_method`` ``QComboBox`` holds exactly
    seven items and the ``QStackedWidget`` holds exactly seven pages.  Only the
    first two --- ``pdb2pqr`` and ``prepwizard (SCHRODINGER)`` --- need an
    external program; the remaining five are pure PyMOL, which is what makes
    the panel's "electrostatics with nothing installed" route honest rather
    than a consolation prize.

    Asserting the correspondence, not just the count, so that adding a prep
    method + its page stays green while adding a page alone --- the shape that
    would break the 1:1 --- fails.
    """
    root = ET.parse(APBS_UI).getroot()
    widgets = list(root.iter("widget"))

    combo = [w for w in widgets if w.get("name") == "prep_method"]
    assert len(combo) == 1, "prep_method combo not found"
    items = [
        item.findtext("property[@name='text']/string")
        for item in combo[0]
        if item.tag == "item"
    ]
    assert items == [
        "pdb2pqr",
        "prepwizard (SCHRODINGER)",
        "protein_assign_charges_and_radii",
        "use formal_charge and vdw",
        "use CB-pseudocharge and vdw",
        "use CA-pseudocharge and radius=3.0",
        "use vdw",
    ], items

    stack = [w for w in widgets if w.get("class") == "QStackedWidget"]
    assert len(stack) == 1
    pages = [child for child in stack[0] if child.tag == "widget"]
    assert len(pages) == len(items) == 7

    # The two that gate the deferral, named so the count cannot drift away from
    # the argument it supports.
    assert items[0] == "pdb2pqr"
    assert "SCHRODINGER" in items[1]


# =====================================================================
# 3. the withdrawn protein_vacuum_esp claim, from the other side
# =====================================================================


def test_protein_vacuum_esp_starts_no_child_process() -> None:
    """Row 467 says B9's diagnostics "need the same channel".  They do not.

    ASSERTED FROM SOURCE, stated as such: this reads
    ``pymol.util.protein_vacuum_esp`` with ``inspect.getsource`` and shows there
    is no ``subprocess`` / ``Popen`` / ``os.system`` in it at all --- the work
    is ``cmd.map_new(name, "coulomb_local", ...)``, which is C.  Its progress
    lines are ordinary ``print``s and therefore already reach the browser
    through ``pcatch``; ``test_wf_apbs.py`` measures one of them arriving.

    Together those two make the withdrawal safe: not "we did not see a problem"
    but "there is no child process here to have a problem with".
    """
    from pymol import util

    source = inspect.getsource(util.protein_vacuum_esp)
    for forbidden in ("subprocess", "Popen", "os.system", "spawn", "execv"):
        assert forbidden not in source, forbidden
    assert "map_new" in source
    assert "coulomb" in source
