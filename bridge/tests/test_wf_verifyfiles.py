"""ADVERSARIAL VERIFICATION of parity rows 295 and 298 (area 6, wave 6).

``bridge/tests/test_wf_files.py`` is the first agent's file.  This one exists to
attack the two claims it makes, and to pin the three things it did NOT pin:

* **295** — only five of ``mimic_tk``'s seven entry points were exercised over
  the socket.  ``askopenfiles`` and ``asksaveasfile`` are pinned here, because
  they are the two that return **open file objects**, which is the shape a
  legacy plugin is most likely to break on (``for line in handle``).
* **295** — nothing installed the shim.  ``install()`` on the files service does
  NOT install it (asserted below, because that is deliberate: seeding
  ``sys.modules['tkFileDialog']`` unconditionally would break
  ``test_wf_plugins.py``'s "no toolkit is reachable" assertions).  The client
  now does it on mount (``apps/web/src/features/files/FileDropTarget.tsx``,
  pinned by ``wfVerifyTkInstall.dom.test.tsx``).  Left unfixed, a plugin worker
  thread reached the REAL ``tkinter.filedialog`` and **aborted this process** —
  measured by deleting the ``sys.meta_path`` finder and re-running the first
  agent's own test::

      *** Terminating app due to uncaught exception
          'NSInternalInconsistencyException', reason:
          'NSWindow should only be instantiated on the main thread!'
      libc++abi: terminating due to uncaught exception of type NSException
      Fatal Python error: Aborted            (pytest exit 134, SIGABRT)

* **298** — the refusal is CLIENT-SIDE ONLY.  ``cmd.load`` is a plain allowed
  call, so the console still executes a ``.pwg``.  That is stated in the first
  agent's annotation; here it is an executable fact, so that the day a
  server-side gate lands in ``bridge/tenmol_bridge/policy/`` this test fails and
  says so.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_wf_verifyfiles.py -q
"""

from __future__ import annotations

import ast
import os
import shutil
import tempfile
import time
from typing import Any, Dict, List

import pytest

NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"

#: Tag counter, so two assertions never read each other's console line.
_TAG = [0]


def _next_tag(stem: str) -> str:
    _TAG[0] += 1
    return "TMVF%s%d" % (stem, _TAG[0])


def _tagged(bridge: Any, tag: str, timeout: float = 8.0) -> str:
    """Read back a ``print('TAG', ...)`` line, skipping PyMOL's command echo.

    PyMOL prints ``PyMOL>print('TAG', ...)`` BEFORE it runs the statement, so a
    substring match finds the echo instead of the output.  ``startswith(tag)``
    cannot match the echo, which starts with ``PyMOL>``.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1 :]
        time.sleep(0.05)
    raise AssertionError("no console line tagged %r within %.1fs" % (tag, timeout))


#: Roots this file may drag into the ONE SHARED PYMOL PROCESS.  Exercising the
#: shim runs ``import tkinter.filedialog``, which loads the real ``tkinter``;
#: ``test_wf_plugins.py`` asserts (correctly) that no toolkit module is ever
#: reachable in this process, and two of its tests fail if this is not undone.
_TK_ROOTS = ("tkinter",)
_TK_FLAT = ("tkFileDialog",)


def _tk_modules(ws, bridge) -> List[str]:
    tag = _next_tag("MODS")
    ws.do(
        "import sys; print('%s', repr(sorted(m for m in sys.modules "
        "if m.split('.')[0] in %r or m in %r)))" % (tag, _TK_ROOTS, _TK_FLAT)
    )
    return list(ast.literal_eval(_tagged(bridge, tag)))


@pytest.fixture
def files(ws, bridge):
    """Files service installed; every process global this file touches put back."""
    ws.do(BOOTSTRAP)
    before = _tk_modules(ws, bridge)
    yield ws

    for request in ws.call(NS + ".dialog_pending"):
        ws.call(NS + ".dialog_cancel", request["dialogId"])
    ws.call(NS + ".uninstall_tk_dialogs")
    ws.do(
        "import sys; _tmvf_keep = %r; [sys.modules.pop(m, None) for m in "
        "list(sys.modules) if (m.split('.')[0] in %r or m in %r) "
        "and m not in _tmvf_keep]" % (before, _TK_ROOTS, _TK_FLAT)
    )
    # `{t:'do'}` execs in the `pymol` module namespace, so the probe slots this
    # file writes are attributes of `pymol`.  Sweep them too.
    ws.do(
        "import pymol; [delattr(pymol, n) for n in list(vars(pymol)) "
        "if n.startswith('_tmvf_')]"
    )
    assert _tk_modules(ws, bridge) == before, "tkinter leaked out of this file"


def _await_pending(ws, timeout: float = 10.0) -> List[Dict[str, Any]]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        pending = ws.call(NS + ".dialog_pending")
        if pending:
            return pending
        time.sleep(0.05)
    raise AssertionError("no dialog request arrived within %.1fs" % timeout)


def _await_slot(ws, bridge, slot: str, timeout: float = 10.0) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        tag = _next_tag("SLOT")
        ws.do("print('%s', repr(%s))" % (tag, slot))
        value = _tagged(bridge, tag)
        if value != "{}":
            return value
        time.sleep(0.1)
    raise AssertionError("%s never filled in" % slot)


# =========================================================================== #
# Row 298 — the .pwg launcher, and where the refusal is NOT
# =========================================================================== #


class TestPwgIsReallyExecuted:
    def test_the_pwg_loader_is_processPWG(self, files, bridge):
        """Read the live registry rather than trusting ``importing.py``."""
        tag = _next_tag("LOADER")
        files.do(
            "from pymol import importing; print('%s', "
            "importing.loadfunctions['pwg'].__name__)" % tag
        )
        assert _tagged(bridge, tag) == "_processPWG"

    def test_cmd_load_executes_a_pwg_with_no_confirmation(self, ws):
        """Independent reproduction, with a different file and a witness.

        The ``delete`` directive makes ``_processPWG`` ``os.unlink`` the file it
        is reading (``modules/pymol/importing.py:597-598``).  With no ``port``
        and no ``root``, ``launch_flag`` stays 0, so no ``PymolHttpd`` starts and
        no browser opens — the vanishing file is the entire observable effect.

        A SECOND file sits next to it and must survive, so that "the file is
        gone" cannot be explained by the temp directory being wiped.
        """
        workdir = tempfile.mkdtemp(prefix="tenmol-verify-pwg-")
        try:
            bomb = os.path.join(workdir, "verify.pwg")
            witness = os.path.join(workdir, "witness.txt")
            with open(bomb, "w") as handle:
                handle.write("# nothing is launched: no port, no root\ndelete\n")
            with open(witness, "w") as handle:
                handle.write("still here\n")

            reply = ws.call_reply("cmd.load", bomb)
            assert reply["t"] == "ok", reply
            # `_processPWG` returns -1 when it did not launch a server.
            assert reply["result"] == -1, reply

            assert not os.path.exists(bomb), (
                "the .pwg was NOT executed; importing.py:597 changed and row "
                "298's evidence needs redoing"
            )
            assert os.path.exists(witness), "the whole directory went, not the file"
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def test_the_refusal_is_client_side_only(self, files):
        """RESIDUAL RISK, pinned so it cannot be quietly forgotten.

        ``classify`` says "refused" and both client routes honour it, but
        ``cmd.load`` itself is a plain allowed call: a typed
        ``load app.pwg`` in the console still runs the directives.  When a
        server-side gate lands in ``bridge/tenmol_bridge/policy/`` this test
        fails, which is the intended signal.
        """
        assert files.call(NS + ".classify", "/tmp/x.pwg")["refused"]

        workdir = tempfile.mkdtemp(prefix="tenmol-verify-pwg2-")
        try:
            bomb = os.path.join(workdir, "console.pwg")
            with open(bomb, "w") as handle:
                handle.write("delete\n")
            reply = files.call_reply("cmd.load", bomb)
            assert reply["t"] == "ok", "the bridge started gating cmd.load -- good"
            assert not os.path.exists(bomb), (
                "the bridge started gating cmd.load('*.pwg'); move this row's "
                "'client-side only' caveat out of the annotation"
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def test_the_refusal_table_is_reachable_in_one_round_trip(self, files):
        """``hello.refused`` is what the client keys on before any load."""
        hello = files.call(NS + ".hello")
        assert "pwg" in hello["refused"]
        assert "refused by the web client" in hello["refused"]["pwg"]
        # ...and it is NOT the same table as `unavailable` ("this build cannot").
        assert "pwg" not in hello["unavailable"]
        assert ".pwg" not in hello["unavailable"]


# =========================================================================== #
# Row 295 — the shim's wiring, and the two entry points nothing exercised
# =========================================================================== #


class TestShimWiring:
    def test_installing_the_service_does_NOT_install_the_shim(self, files):
        """Deliberate, and the reason the client has to ask for it.

        Seeding ``sys.modules['tkFileDialog']`` on every ``files.install()``
        would make ``test_wf_plugins.py``'s "no toolkit module is reachable"
        assertions false for the whole suite.  So the shim is opt-in, which
        means SOMETHING has to opt in: nothing did until
        ``FileDropTarget`` (always mounted) started calling
        ``install_tk_dialogs`` on mount.
        """
        assert files.call(NS + ".tk_dialogs_status")["installed"] is False
        files.call(NS + ".install_tk_dialogs")
        assert files.call(NS + ".tk_dialogs_status")["installed"] is True
        files.call(NS + ".uninstall_tk_dialogs")
        assert files.call(NS + ".tk_dialogs_status")["installed"] is False

    def test_install_is_idempotent(self, files):
        assert files.call(NS + ".install_tk_dialogs")["already"] is False
        assert files.call(NS + ".install_tk_dialogs")["already"] is True


class TestTheTwoUnexercisedEntryPoints:
    """``askopenfiles`` and ``asksaveasfile`` — the ones returning file objects."""

    def test_askopenfiles_returns_a_LIST_of_open_handles(self, files, bridge):
        files.call(NS + ".install_tk_dialogs")
        workdir = tempfile.mkdtemp(prefix="tenmol-verify-tk-")
        try:
            paths = []
            for i, body in enumerate(("REMARK one\n", "REMARK two\n")):
                path = os.path.join(workdir, "f%d.pdb" % i)
                with open(path, "w") as handle:
                    handle.write(body)
                paths.append(path)

            files.do(
                "import threading, tkinter.filedialog as _fd; _tmvf_files = {}; "
                "threading.Thread(target=lambda: _tmvf_files.update("
                "{'v': [h.read() for h in _fd.askopenfiles()]}), "
                "daemon=True).start()"
            )
            request = _await_pending(files)[0]
            # `askopenfiles` sets multiple=1, so it must arrive as the plural
            # kind -- if it did not, the client would answer with a bare string
            # and `[open(f, mode) for f in r]` would iterate it CHARACTER BY
            # CHARACTER (`mimic_tk.py:62-63`).
            assert request["kind"] == "askopenfilenames"
            assert request["options"]["multiple"] is True

            files.call(NS + ".dialog_answer", request["dialogId"], paths)
            assert (
                _await_slot(files, bridge, "_tmvf_files")
                == "{'v': ['REMARK one\\n', 'REMARK two\\n']}"
            )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def test_asksaveasfile_hands_back_a_writable_handle(self, files, bridge):
        files.call(NS + ".install_tk_dialogs")
        workdir = tempfile.mkdtemp(prefix="tenmol-verify-tk2-")
        try:
            target = os.path.join(workdir, "out.txt")
            # One line, because `{t:'do'}` is a single statement: the inner
            # lambda writes through the handle the shim returned and yields its
            # `.name`, so the assertion sees BOTH that a real file object came
            # back and that it was opened for writing.
            files.do(
                "import threading, tkinter.filedialog as _fd; _tmvf_save = {}; "
                "threading.Thread(target=lambda: _tmvf_save.update({'v': "
                "(lambda h: (h.write('written by a plugin\\n'), h.close(), "
                "h.name)[-1])(_fd.asksaveasfile())}), daemon=True).start()"
            )
            request = _await_pending(files)[0]
            assert request["kind"] == "asksaveasfilename"

            files.call(NS + ".dialog_answer", request["dialogId"], target)
            assert _await_slot(files, bridge, "_tmvf_save") == "{'v': %r}" % target
            with open(target) as handle:
                assert handle.read() == "written by a plugin\n"
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def test_a_cancelled_file_dialog_is_None_not_a_crash(self, files, bridge):
        """``mimic_tk.py:65-67,81-83``: ``if not r: return None``.

        A plugin writes ``handle = asksaveasfile(); if handle is None: return``.
        Answering with `''` instead would make it ``open('')`` and raise.
        """
        files.call(NS + ".install_tk_dialogs")
        files.do(
            "import threading, tkinter.filedialog as _fd; _tmvf_none = {}; "
            "threading.Thread(target=lambda: _tmvf_none.update("
            "{'v': repr(_fd.asksaveasfile())}), daemon=True).start()"
        )
        request = _await_pending(files)[0]
        files.call(NS + ".dialog_cancel", request["dialogId"])
        assert _await_slot(files, bridge, "_tmvf_none") == "{'v': 'None'}"

    def test_answering_an_unknown_dialog_id_is_refused_not_ignored(self, files):
        result = files.call(NS + ".dialog_answer", 99999, "/tmp/x.pdb")
        assert result["answered"] is False
        assert "no open dialog" in result["error"]
