"""WP-25 (APBS slot) — the ``subproc`` namespace.

WHAT IS GRANTED
---------------
The root ``subproc``, backed by :mod:`tenmol_bridge.subproc`:

    subproc.which(name)        absolute path of a program, or None
    subproc.execute(argv, ..)  run it, streaming stdout+stderr onto the
                               PyMOL console -> the ``feedback`` topic

Parity inventory row 467 ("Subprocess stdout/stderr into the feedback topic")
names this as the one piece of APBS that is worth building before the dialog
port: a child process inherits the *server's* file descriptors, not ``pcatch``,
so today everything it prints lands on the terminal the bridge was launched
from and the browser sees nothing.  :mod:`tenmol_bridge.subproc` explains the
measurement and why the fix is "pipe and print" rather than a global fd tee.

``subproc.which`` is what makes the APBS panel honest: instead of the prose
"``apbs`` and ``pdb2pqr`` are probably not installed", the panel *asks*, and
says which of the two it found and where.

HOW THE MODULE BECOMES ADDRESSABLE
----------------------------------
Exactly the mechanism ``wp-16.py`` established, for exactly the same reason.
``dispatch.py`` resolves a root that is not ``cmd``/``chempy`` to
``pymol.<root>``, and ``dispatch.py`` belongs to WP-02; plan §5.1 rule 1 says a
work package that needs a change elsewhere *reports* it rather than making it.
So this file seeds ``sys.modules`` with the name the dispatcher will look for::

    sys.modules["pymol.subproc"] = tenmol_bridge.subproc

REQUESTED UPSTREAM (WP-02): add ``"subproc": "tenmol_bridge.subproc"`` to
``dispatch._ROOT_MODULES`` and this seeding disappears.

DANGEROUSNESS
-------------
``execute`` starts a local program, so it is marked dangerous and the client is
told.  It invalidates nothing by itself — a child process cannot touch the
session; whatever the caller does with the output is a separate call.

WITHDRAWN CLAIM.  This file used to say ``execute`` was "strictly *weaker* than
``cmd.system``, which the policy already permits after one confirmation ... so
there is no metacharacter, pipeline or redirection surface at all".  Measured,
that is false: ``argv[0]`` is allowed to be a shell.
``subproc.execute(["/bin/sh", "-c", "echo pwned > /tmp/x; echo RAN"])`` comes
back ``{"t": "ok", "dangerous": true}`` with **no** confirmation and the file is
created, while ``cmd.system("true")`` in the same session is refused with
"cmd.system needs a one-time confirmation".  ``CONFIRM_ONCE``
(``policy/base.py:153``) is ``{"system"}``; ``execute`` is not in it.  So the
comparison runs the other way — same capability, fewer gates.

Deliberately NOT "fixed" by adding ``execute`` to ``CONFIRM_ONCE``, for two
reasons.  (1) ``Grant`` has no field that feeds ``CONFIRM_ONCE``, so it would
mean editing ``policy/base.py``, a shared file this work package does not own.
(2) It would be theatre while ``cmd.do`` — dangerous, ungated, and able to run
``import subprocess`` — is reachable on the same socket.  The real decision is
one level up: whether an authenticated localhost client may start processes at
all.  REPORTED for that decision rather than silently narrowed here; pinned as
it actually behaves in ``bridge/tests/test_wf_apbsverify.py``.
"""

from __future__ import annotations

import importlib
import sys

# Absolute, not relative: grant files are loaded by PATH under a synthetic
# module name (`policy/__init__.py:_load_grant_file`).
from tenmol_bridge.policy.base import Grant

_SERVICE = importlib.import_module("tenmol_bridge.subproc")
sys.modules.setdefault("pymol.subproc", _SERVICE)

GRANT = Grant(
    wp="WP-25",
    note=(
        "subproc.which / subproc.execute: child stdout+stderr streamed onto the "
        "PyMOL console instead of the bridge server's terminal "
        "(tenmol_bridge.subproc, aliased as pymol.subproc)"
    ),
    roots={"subproc"},
    dangerous={
        # LEAF-KEYED, process-wide (`Policy.check` looks up `segments[-1]`), so
        # the leaf may not be `run`: that key already belongs to `cmd.run`
        # ("executes an arbitrary Python file") and carries `resync`
        # invalidation.  Reusing it would silently rewrite the danger text of
        # File > Run Script and make every child process force a full client
        # resync.  Hence `execute`, which collides with nothing.
        # The text a user is shown, so it must not repeat the withdrawn claim.
        # "never a shell" was the old wording and it reads as a limit on what
        # can run; it is not one, because argv[0] may be `/bin/sh`.
        "execute": (
            "starts a local program of the caller's choosing; no shell is "
            "interposed, but argv[0] may itself be one"
        ),
    },
)
