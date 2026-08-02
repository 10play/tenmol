"""WP-18 / parity area 6, wave 9 — the last file-I/O rows.

Row 279 (``movie.produce``) is the only one of the nine rows in this third that
needed a PRODUCT change; the rest were coverage gaps already closed by
``test_p8_a6.py`` and pinned again by the web tests named in the annotations.

ROW 279, in one paragraph.  The wave-4 note says the bridge "was observed
exiting shortly after `` produce: finished.``".  ``FilesAPI.produce`` already
carried a guard for that — it points fd 0 at ``/dev/null`` so the encoder
cannot inherit the server's stdin — but the guard was measurably USELESS on the
path the browser takes: ``movie.produce`` hard-codes ``mpng(..., modal=-1)``
(``packages/engine/modules/pymol/movie.py:973``), which installs a ``MovieModalDraw`` and makes
``get_modal_draw()`` true, so ``produce`` hands ``_encode`` to a **daemon
thread** (``:982-987``) and returns.  ``FilesAPI.produce``'s ``finally`` then
restores fd 0 — *before* ffmpeg is spawned.  ``ffmpeg`` is started with
``subprocess.Popen(args, stderr=PIPE)`` and no ``stdin=`` (``movie.py:770-800``),
so it inherited the real descriptor 0 anyway, and `` produce: finished.`` is
printed by that same detached thread: exactly the ordering wave 4 saw.

Measured here before the fix (run against the unpatched ``panels/files.py``)::

    cmd.tenmol_files.produce(...)  ->  {'ok': False, 'size': 0,
                                        'error': 'no output file was written'}
    cmd.get_modal_draw()           ->  1
    cmd.count_atoms('ala')         ->   Error: APIEnterNotModal(G)
    the .mp4 appeared 1.6 s LATER, written by MainThread's daemon child

so the browser was ALSO told the export had failed while it was still running,
and the engine raised on the next call.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p9_f3.py -q
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from typing import Any, Dict, List

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
NS = "cmd.tenmol_files"
BOOTSTRAP = "import tenmol_bridge.panels.files as _tf; _tf.install()"

HAVE_FFMPEG = bool(shutil.which("ffmpeg"))
HAVE_FFPROBE = bool(shutil.which("ffprobe"))

needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not on PATH")

#: Globals ``produce`` writes and does not put back (``movie.py:935`` leaves
#: ``opaque_background`` on; ``:971`` sets ``keep_alive`` and only ``_encode``
#: unsets it).  Saved here because this file shares one PyMOL with 1594 others.
_SAVED_INT = ("opaque_background", "keep_alive", "ray_trace_frames", "movie_quality")


@pytest.fixture
def files(ws):
    ws.do(BOOTSTRAP)
    yield ws


@pytest.fixture
def movie_env(files):
    """A two-frame movie, with every global ``produce`` touches restored."""
    ws = files
    saved = {name: ws.call("cmd.get_setting_int", name) for name in _SAVED_INT}
    cwd = os.getcwd()
    ws.call("cmd.mset")
    ws.call("cmd.delete", "all")
    ws.call("cmd.fragment", "ala", "p9f3mov")
    ws.call("cmd.mset", "1 x2")
    try:
        yield ws
    finally:
        ws.call("cmd.mset")
        ws.call("cmd.delete", "p9f3mov")
        ws.call("cmd.frame", 1)
        for name, value in saved.items():
            ws.call("cmd.set", name, value)
        # `_encode` chdirs the whole process for the duration of the encode
        # (`movie.py:748,763`); a test that left it moved would break every
        # relative path in the rest of the suite.
        assert os.getcwd() == cwd, "the encode left the process in %s" % os.getcwd()


def _ffprobe(path: str) -> Dict[str, Any]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,codec_name", "-of", "default=nw=1", path],
        capture_output=True, text=True,
    )
    return dict(
        line.split("=", 1) for line in out.stdout.strip().splitlines() if "=" in line
    )


# =========================================================================== #
# Row 279 — the browser's movie export, and the process it runs in
# =========================================================================== #


@needs_ffmpeg
class TestMovieExportKeepsTheProcess:
    """``cmd.tenmol_files.produce`` — the RPC ``FilesPanel`` calls."""

    def test_the_rpc_returns_with_the_file_written_and_no_modal_window(
        self, movie_env, tmp_path
    ):
        """The whole encode happens INSIDE the fd-0 guard, or the guard is a lie.

        ``FilesAPI.produce`` redirects descriptor 0 to ``/dev/null`` for the
        duration of the ``movie.produce`` call and restores it in a ``finally``.
        That protects ffmpeg's ``stdin`` only if ffmpeg runs before the
        ``finally`` — i.e. only if ``_encode`` is synchronous.  These three
        assertions are what "synchronous" looks like from outside the process:
        the answer reports a real file, the file is on disk the instant the
        reply arrives, and no ``MovieModalDraw`` is left behind.

        Every one of the three was FALSE before this wave (see the module
        docstring for the numbers).
        """
        ws = movie_env
        target = str(tmp_path / "browser.mp4")
        out = ws.call(NS + ".produce", target, width=64, height=48, mode="draw",
                      quality=90, encoder="ffmpeg", quiet=1, timeout=300)

        assert out["ok"] is True, out
        assert out["error"] is None, out
        assert out["path"] == target
        assert out["size"] > 0 and os.path.getsize(target) == out["size"]
        # The reply is the truth at the moment it was sent, not a promise.
        assert os.path.exists(target)
        assert ws.call("cmd.get_modal_draw") == 0
        # ... and the engine answers, which it does not while a modal draw is up.
        assert ws.call("cmd.count_atoms", "p9f3mov") == 10

        if HAVE_FFPROBE:
            probe = _ffprobe(target)
            assert probe.get("codec_name") == "h264", probe
            assert (probe.get("width"), probe.get("height")) == ("64", "48"), probe

    def test_the_temp_directory_is_gone_when_the_reply_arrives(
        self, movie_env, tmp_path
    ):
        """``<basename>.tmp`` is removed by ``_encode``'s last statement.

        Its absence at reply time is the second, independent witness that
        ``_encode`` ran on this thread: the daemon-thread build left a
        directory full of ``mov0001.png`` behind for another second and a half.
        """
        ws = movie_env
        target = str(tmp_path / "clean.mp4")
        out = ws.call(NS + ".produce", target, width=64, height=48, mode="draw",
                      encoder="ffmpeg", quiet=1, timeout=300)
        assert out["ok"] is True, out
        assert not os.path.exists(str(tmp_path / "clean.tmp")), sorted(
            os.listdir(str(tmp_path))
        )

    def test_the_bridge_is_still_serving_after_produce_finished(
        self, movie_env, bridge, tmp_path
    ):
        """The wave-4 symptom itself: the process exiting after the export.

        A client stays attached for the whole export, `` produce: finished.``
        is read off the feedback stream (that is the exact line wave 4 saw the
        shutdown after), and then the server is asked for ``/healthz`` over
        HTTP and for a value over the socket -- two different paths into the
        process, both after the marker.
        """
        ws = movie_env
        target = str(tmp_path / "alive.mp4")
        out = ws.call(NS + ".produce", target, width=64, height=48, mode="draw",
                      encoder="ffmpeg", quiet=0, timeout=300)
        assert out["ok"] is True, out

        lines = bridge.wait_for_feedback(" produce: finished.", timeout=10.0)
        assert any(" produce: finished." in line for line in lines), lines[-8:]

        # Give the "shortly after" of the wave-4 note somewhere to happen.
        time.sleep(1.5)
        health = bridge.healthz()
        assert health["shutdownRequested"] is False, health
        assert health["clients"] >= 1, health
        assert ws.call("cmd.get_names", "all") == ["p9f3mov"]

    def test_keep_alive_is_not_left_on(self, movie_env, tmp_path):
        """``movie.py:971`` sets it; only ``_encode:811`` unsets it.

        A produce that returned before ``_encode`` ran left the engine pinned
        awake for the rest of the session -- 60 Hz of draw for nothing.
        """
        ws = movie_env
        ws.call("cmd.set", "keep_alive", 0)
        target = str(tmp_path / "ka.mp4")
        assert ws.call(NS + ".produce", target, width=64, height=48, mode="draw",
                       encoder="ffmpeg", quiet=1, timeout=300)["ok"] is True
        assert ws.call("cmd.get_setting_int", "keep_alive") == 0

    def test_a_failing_encoder_is_reported_not_raised(self, movie_env, tmp_path):
        """The other half of the answer the browser renders.

        ``.mkv`` is not in ``produce``'s extension table, so ``produce`` raises
        ``CmdException`` before any frame is rendered; the wrapper turns it into
        ``ok=False`` + a message, which is what ``FilesPanel`` prints.
        """
        ws = movie_env
        target = str(tmp_path / "bad.mkv")
        out = ws.call(NS + ".produce", target, width=64, height=48, mode="draw",
                      encoder="nosuchencoder", quiet=1, timeout=300)
        assert out["ok"] is False, out
        assert out["error"]
        assert not os.path.exists(target)
        # and the engine is untouched by the failure
        assert ws.call("cmd.get_modal_draw") == 0


# =========================================================================== #
# Row 295 — the plugin file-dialog shim's give-up path
# =========================================================================== #


_TAG = [0]


def _next_tag(stem: str) -> str:
    _TAG[0] += 1
    return "TENMOLP9F3%s%d" % (stem, _TAG[0])


def _tagged(bridge, tag: str, timeout: float = 8.0) -> str:
    """Read back a ``print('TAG', ...)`` from the console drain.

    Skips the ECHO line -- PyMOL prints ``PyMOL>print('TAG', ...)`` before it
    runs the statement, and ``startswith`` cannot match that.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for line in bridge.feedback_lines():
            if line.startswith(tag + " "):
                return line[len(tag) + 1:]
        time.sleep(0.05)
    raise AssertionError("no console line tagged %s" % tag)


#: ``sys.modules`` roots the shim moves.  MEASURED THE HARD WAY: popping a
#: hand-written list instead of everything that appeared leaves
#: ``tkinter.constants`` etc. behind, and ``test_wf_plugins.py``'s two
#: "no tkinter anywhere" assertions then fail 60 tests later, in another file.
_TK_ROOTS = ("tkinter",)
_TK_FLAT = ("tkFileDialog",)


def _tk_modules(ws, bridge) -> List[str]:
    tag = _next_tag("TKMODS")
    ws.do(
        "import sys; print('%s', repr(sorted(m for m in sys.modules "
        "if m.split('.')[0] in %r or m in %r)))" % (tag, _TK_ROOTS, _TK_FLAT)
    )
    import ast

    return list(ast.literal_eval(_tagged(bridge, tag)))


@pytest.fixture
def shim(files, bridge):
    """The tk shim installed, and every process-global it moves put back."""
    ws = files
    before = _tk_modules(ws, bridge)
    ws.call(NS + ".install_tk_dialogs")
    yield ws
    for request in ws.call(NS + ".dialog_pending"):
        ws.call(NS + ".dialog_cancel", request["dialogId"])
    ws.call(NS + ".uninstall_tk_dialogs")
    ws.do(
        "import sys; _tenmol_keep = %r; [sys.modules.pop(m, None) for m in "
        "list(sys.modules) if (m.split('.')[0] in %r or m in %r) "
        "and m not in _tenmol_keep]" % (before, _TK_ROOTS, _TK_FLAT)
    )
    ws.do(
        "import pymol; [delattr(pymol, n) for n in list(vars(pymol)) "
        "if n.startswith('_p9f3_') or n == '_tenmol_keep']"
    )
    # The class attribute this file writes is process-global too.
    ws.do(
        "import tenmol_bridge.panels.files as _tf; "
        "_tf.DialogBroker.DEFAULT_TIMEOUT = 300.0"
    )
    assert _tk_modules(ws, bridge) == before


class TestPluginDialogGivesUp:
    """The 300 s give-up, actually waited out (with the clock turned down).

    Wave 6 read ``DEFAULT_TIMEOUT`` out of the source and said so.  Nothing had
    ever run ``DialogBroker.ask``'s ``remaining <= 0`` branch, which is the one
    that decides what a plugin sees when the browser never answers: it must be
    *tkinter's cancel value* (``''``), not ``None`` and not an exception, or the
    plugin's ``if not filename: return`` turns into a traceback.
    """

    def test_an_unanswered_dialog_becomes_a_cancel_not_a_hang(self, shim, bridge):
        ws = shim
        ws.do(
            "import tenmol_bridge.panels.files as _tf; "
            "_tf.DialogBroker.DEFAULT_TIMEOUT = 0.6"
        )
        ws.do(
            "import threading, tkinter.filedialog as _fd; _p9f3_slot = {}; "
            "threading.Thread(target=lambda: _p9f3_slot.update("
            "{'v': _fd.askopenfilename(title='never answered')}), "
            "daemon=True).start()"
        )

        # It really parks first -- otherwise the timeout below would be proving
        # that nothing was ever asked.
        deadline = time.monotonic() + 10.0
        pending: List[Dict[str, Any]] = []
        while time.monotonic() < deadline and not pending:
            pending = ws.call(NS + ".dialog_pending")
            time.sleep(0.05)
        assert pending, "the plugin never parked a request"
        dialog_id = pending[0]["dialogId"]

        # ... and then nobody answers.
        deadline = time.monotonic() + 15.0
        value = "{}"
        while time.monotonic() < deadline and value == "{}":
            tag = _next_tag("SLOT")
            ws.do("print('%s', repr(_p9f3_slot))" % tag)
            value = _tagged(bridge, tag)
            if value == "{}":
                time.sleep(0.2)
        assert value == "{'v': ''}", value

        lines = bridge.wait_for_feedback("no answer to file dialog", timeout=5.0)
        note = [line for line in lines if "no answer to file dialog" in line]
        assert note, lines[-6:]
        assert "treating it as Cancel" in note[-1]
        assert "after 1s" in note[-1], note[-1]  # "%.0fs" of 0.6

        # The request is gone: it is not left for the next poll to re-open.
        assert ws.call(NS + ".dialog_pending") == []
        answered = ws.call(NS + ".dialog_answer", dialog_id, "/tmp/too/late.pdb")
        assert answered["answered"] is False
        assert "no open dialog" in answered["error"]

    def test_the_default_is_300_seconds_and_is_what_the_client_is_told(self, shim):
        """The number the console note quotes, and the one the UI can show."""
        status = shim.call(NS + ".tk_dialogs_status")
        assert status["timeout"] == 300.0
        assert status["installed"] is True


# =========================================================================== #
# Row 273 — the two copies of the four mode labels, pinned to each other
# =========================================================================== #


def test_the_png_mode_labels_are_the_same_string_in_both_languages(files):
    """``forms/png.ui``'s ``input_rendering`` list exists TWICE in this repo.

    ``panels/files.py::PNG_RENDERING_MODES`` is what ``hello`` serves;
    ``packages/protocol/src/topics/files.ts::PNG_RENDERING_MODES`` is what the
    ``PngDialog`` <select> renders, and the INDEX of the chosen label is what
    ``pngCommands`` turns into ``draw`` / ``opaque_background`` / ``ray=``.  A
    drift between the two copies would silently re-map the modes: nothing else
    in either suite compares them, because neither language can import the
    other's list.  This reads the TypeScript source and does.
    """
    import ast
    import re

    source = os.path.join(
        REPO, "packages", "protocol", "src", "topics", "files.ts"
    )
    with open(source) as handle:
        text = handle.read()
    body = re.search(
        r"export const PNG_RENDERING_MODES = \[(.*?)\] as const;", text, re.S
    )
    assert body, "PNG_RENDERING_MODES is no longer a literal array in %s" % source
    client = [
        ast.literal_eval(item.strip().replace("'", '"'))
        for item in body.group(1).strip().rstrip(",").split(",\n")
    ]
    assert client == files.call(NS + ".hello")["pngRenderingModes"], client
    # ... and the order is the one the command index depends on.
    assert client[0].startswith("capture") and client[3].endswith("transparent background")
