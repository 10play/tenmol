"""Child-process output -> the ``feedback`` topic (parity inventory row 467).

THE DEFECT THIS FIXES, MEASURED
-------------------------------
A child process inherits the *file descriptors* 1 and 2 of the bridge server,
not Python's ``sys.stdout``.  ``pcatch`` (``packages/engine/layer1/P.cpp:2662-2674``) is a
Python-level object installed as ``sys.stdout``/``sys.stderr``; it has no
descriptor at all.  So::

    {t:'do'} import subprocess; subprocess.call(['/bin/echo', 'hello'])

prints ``hello`` on the terminal the *server* was launched from and **nothing**
reaches the browser.  Measured on this machine over a real socket
(``packages/bridge/tests/test_wf_apbs.py::test_a_bare_inheriting_subprocess_never_reaches_the_browser``):
the ``PyMOL>`` command echo arrived on the ``feedback`` topic, the child's line
did not, in either the status-poller ring or the WebSocket frames.

That is exactly the hole ``packages/engine/data/startup/apbs_gui/electrostatics.py:156`` falls
into --- ``subprocess.Popen([exe, infile], cwd=tempdir)`` with no ``stdout=``
--- while ``creating.py:104,215`` gets it right by piping and then ``print``-ing
what it collected.

WHY THE FIX IS "PIPE AND PRINT" AND NOT A GLOBAL fd TEE
-------------------------------------------------------
The obvious fix --- ``dup2`` a pipe over fd 1/2 process-wide and publish what
comes out --- is wrong here, and the reason is in the C:
``OrthoNewLine`` (``packages/engine/layer1/Ortho.cpp:1143-1169``) **already** ``printf``s every
console line to real stdout when ``Feedback(G, FB_Python, FB_Output)`` is on.
So a global tee either

* re-``print``s what it captured, which loops forever
  (print -> pcatch -> OrthoAddOutput -> OrthoNewLine -> printf -> fd 1 -> tee),
  or
* publishes straight into the fan-out, which double-reports **every** ordinary
  console line, because each one is already in the Ortho queue.

Piping the child explicitly has neither problem: the child's descriptor is the
pipe, so nothing it writes ever touches fd 1, and the one copy we ``print`` goes
down the ordinary, already-proven pcatch -> Ortho -> ``_get_feedback`` ->
``feedback`` route.

STREAMING IS REAL, ALSO MEASURED
--------------------------------
The read loop runs on the caller's thread --- the engine thread for a
``{t:'call'}`` or a ``{t:'do'}``.  That thread is busy for the life of the
child, so no *draws* happen; console output nevertheless keeps flowing, because
the 10 Hz status thread and ``cmd._get_feedback()`` are independent of it.
Measured: a child printing one line per second had its first line on the
``feedback`` topic 0.45 s in, while the ``{t:'do'}`` reply only came back at
3.09 s.  A long ``apbs`` run therefore narrates itself instead of going quiet.

WHAT IS ADDRESSABLE FROM THE WIRE
---------------------------------
``policy/grants/wp-25-apbs.py`` aliases this module as ``pymol.subproc`` and
grants the root, so the client can call ``subproc.which`` and ``subproc.execute``.
``execute`` is marked *dangerous*: it starts a local program.

An earlier version of this docstring claimed ``execute`` was "strictly less
powerful than ``cmd.system``, which is already reachable with one confirmation".
**That was wrong and is withdrawn.**  ``shell=True`` is genuinely never set ---
but ``argv[0]`` may itself *be* a shell, and nothing stops it.  Measured over a
live socket (``test_wf_apbsverify.py::test_execute_reaches_a_full_shell_...``)::

    subproc.execute(["/bin/sh", "-c", "echo pwned > /tmp/x; echo RAN"])
        -> {"t": "ok", "dangerous": true}, no confirmation, /tmp/x created
    cmd.system("true")
        -> {"t": "err", "kind": "NotAllowed",
            "message": "cmd.system needs a one-time confirmation in this session"}

So the honest statement is the opposite of the old one: ``execute`` reaches the
same arbitrary-shell capability as ``cmd.system`` with *fewer* gates, because
``CONFIRM_ONCE`` (``policy/base.py:153``) holds ``system`` and not ``execute``.
What ``shell=False`` buys is narrower than "no metacharacter surface": it is
that ``execute`` never *accidentally* interprets an argument, so a filename
containing ``;`` is passed through literally (pinned in ``test_wf_apbs.py::
test_execute_never_goes_through_a_shell``).

Why this is nevertheless not an escalation: ``cmd.do`` is already dangerous and
already ungated (``DANGEROUS["do"]`` with no ``CONFIRM_ONCE`` entry), and
``cmd.do("import subprocess; ...")`` runs arbitrary Python today --- the defect
test in this area uses exactly that.  ``subproc.execute`` therefore adds a
*channel*, not a *capability*.  Recorded here rather than papered over, so that
whoever tightens the wire surface tightens ``do`` and ``execute`` together.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

from .errors import BridgeError

__all__ = [
    "SubprocessFailed",
    "ExecutableNotFound",
    "which",
    "resolve",
    "execute",
    "capture_children",
    "console_write",
]

#: Hard cap on how much of a child's output is kept in the returned payload.
#: Everything is still printed to the console; this only bounds the JSON reply
#: so one chatty program cannot build a 200 MB frame.
MAX_KEPT_LINES = 5000


class SubprocessFailed(BridgeError):
    """The child ran and exited non-zero (``check=True`` only)."""


class ExecutableNotFound(BridgeError):
    """``argv[0]`` is not on ``PATH`` and is not an executable file."""


# --------------------------------------------------------------- the console


def console_write(text: str) -> None:
    """One line onto PyMOL's console.

    ``print`` and not ``sys.__stdout__.write``: ``sys.stdout`` **is** the
    ``pcatch`` module (``packages/engine/layer1/P.cpp:2716-2720``) and its ``write`` is the
    only documented door into ``OrthoAddOutput``.  Written as a seam so a test
    can capture it without a running engine.
    """
    print(text)


# ------------------------------------------------------------------ locating


def which(program: str, path: Optional[str] = None) -> Optional[str]:
    """Absolute path of ``program``, or ``None``.

    Exposed on the wire because the APBS panel has to *report* whether ``apbs``
    and ``pdb2pqr`` exist rather than assert it in prose.  ``shutil.which``
    already honours an absolute/relative path with a separator in it, so
    ``which('/opt/apbs/bin/apbs')`` answers about that exact file.
    """
    if not isinstance(program, str) or not program:
        return None
    return shutil.which(program, path=path)


def resolve(argv: Sequence[str]) -> List[str]:
    """Validate an argv list and make ``argv[0]`` absolute.

    Raises :class:`ExecutableNotFound` *before* the fork, so the client gets a
    typed error with the name it asked for instead of a bare ``FileNotFoundError``
    from six frames down.
    """
    if isinstance(argv, str):
        raise BridgeError(
            "subproc.execute takes an argv list, not a command string: %r "
            "(a string would need a shell, and this call never uses one)" % argv
        )
    items = [str(item) for item in argv]
    if not items:
        raise BridgeError("subproc.execute needs at least the program name")
    found = shutil.which(items[0])
    if found is None:
        raise ExecutableNotFound(
            "%r is not on PATH and is not an executable file" % items[0],
            program=items[0],
        )
    items[0] = found
    return items


# ----------------------------------------------------------------- the runner


def execute(
    argv: Sequence[str],
    cwd: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
    timeout: Optional[float] = None,
    prefix: str = "",
    check: bool = False,
    echo: bool = True,
    keep: int = MAX_KEPT_LINES,
) -> Dict[str, Any]:
    """Run ``argv``, streaming its merged stdout+stderr onto the console.

    ``stderr`` is folded into ``stdout`` (``STDOUT``) on purpose: two pipes
    means two readers and the interleaving is lost, and PyMOL's console has no
    severity channel anyway (``test_feedback_path.py`` measures that
    ``colorprinting.error`` is indistinguishable from ``print``).  One ordered
    stream is what the user actually sees in a terminal.

    Returns ``{"argv", "returncode", "lines", "truncated", "seconds",
    "timedOut"}`` --- JSON-safe, so it survives the codec unchanged.

    ``env`` replaces the child's environment wholesale (plain ``Popen``
    semantics).  Note that ``argv[0]`` is resolved against the **parent's**
    ``PATH``, before ``env`` exists: pass an absolute path if you are handing
    over an environment with a different one.
    """
    items = resolve(argv)
    child_env = dict(env) if env is not None else None
    if echo:
        console_write(" Running: %s" % " ".join(items))

    started = time.monotonic()
    lines: List[str] = []
    truncated = False
    timed_out = False

    try:
        proc = subprocess.Popen(
            items,
            cwd=cwd,
            env=child_env,
            # DEVNULL, not an inherited stdin: a child that decides to prompt
            # would otherwise read from whatever the *server* was launched
            # with and hang forever with nobody to type into it.  (apbs_gui
            # uses `stdin=PIPE` + `close()` for the same reason, calling it
            # the "Windows pythonw fix", creating.py:105.)
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            bufsize=1,
        )
    except OSError as exc:
        console_write(" Error: could not start %s: %s" % (items[0], exc))
        raise ExecutableNotFound(
            "could not start %r: %s" % (items[0], exc), program=items[0]
        ) from exc

    # A silent, wedged child would block the read loop forever, so the deadline
    # is enforced by a watchdog rather than by checking the clock between lines.
    watchdog: Optional[threading.Timer] = None
    if timeout is not None and timeout > 0:

        def _kill() -> None:
            nonlocal timed_out
            if proc.poll() is not None:
                # It finished in the gap between the last read and
                # `watchdog.cancel()`.  Reporting `timedOut` for a run that
                # completed would be a lie the caller cannot check.
                return
            timed_out = True
            try:
                proc.kill()
            except OSError:
                pass

        watchdog = threading.Timer(float(timeout), _kill)
        watchdog.daemon = True
        watchdog.start()

    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n").rstrip("\r")
            console_write(prefix + line)
            if len(lines) < keep:
                lines.append(line)
            else:
                truncated = True
        proc.stdout.close()
        returncode = proc.wait()
    except BaseException:
        # Never leave an orphan behind: this loop runs on the engine thread and
        # a stray `apbs` holding a temp directory open outlives the session.
        try:
            proc.kill()
            proc.wait(timeout=5.0)
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        if watchdog is not None:
            watchdog.cancel()

    seconds = time.monotonic() - started
    if timed_out:
        console_write(
            " Error: %s exceeded %.1fs and was killed" % (items[0], float(timeout or 0))
        )
    elif returncode != 0 and echo:
        console_write(" Error: %s exited with status %d" % (items[0], returncode))

    result: Dict[str, Any] = {
        "argv": items,
        "returncode": returncode,
        "lines": lines,
        "truncated": truncated,
        "seconds": round(seconds, 3),
        "timedOut": timed_out,
    }
    if check and returncode != 0:
        raise SubprocessFailed(
            "%s failed with exit status %d" % (os.path.basename(items[0]), returncode),
            **result,
        )
    return result


# ------------------------------------------- third-party code we cannot edit


class _Drainer(threading.Thread):
    """Reads one child's pipe and prints it.  Daemon; dies with the pipe."""

    def __init__(self, stream: Any, prefix: str) -> None:
        super().__init__(name="tenmol-subproc-drain", daemon=True)
        self._stream = stream
        self._prefix = prefix

    def run(self) -> None:  # pragma: no cover - exercised through the socket
        """Pump the child's pipe line by line to the console until it closes.

        Decodes bytes leniently and prefixes each line; a closed or broken pipe
        ends the loop quietly and the stream is closed on the way out.
        """
        try:
            for raw in self._stream:
                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", "replace")
                console_write(self._prefix + raw.rstrip("\n").rstrip("\r"))
        except (ValueError, OSError):
            pass
        finally:
            try:
                self._stream.close()
            except Exception:  # noqa: BLE001
                pass


class capture_children:
    """Context manager: give *inherited-fd* children a pipe instead.

    For code that is not ours to edit.  ``apbs_gui`` is the motivating case:
    ``electrostatics.py:156`` is ``subprocess.Popen([exe, infile], cwd=tempdir)``
    with no redirection at all, so ``apbs``'s progress report lands on the
    server's terminal.  Wrapping the call site is not an option --- the call
    site is in ``packages/engine/data/startup/``.

    Inside the block, a ``Popen`` constructed with **no** ``stdout`` gets
    ``stdout=PIPE, stderr=STDOUT`` and a drain thread that prints every line.
    A ``Popen`` that already redirects (``creating.py:104`` writes to a temp
    file, ``:215`` reads ``communicate()``) is left completely alone, so the
    two call sites that are already correct do not change behaviour.

    Caveats, stated rather than hidden:

    * the drain thread ``print``s off the engine thread.  Upstream PyMOL does
      the same thing --- ``apbs_gui/__init__.py`` runs the whole pipeline under
      ``pymol.Qt.utils.AsyncFunc`` and ``creating.py`` prints from that worker
      --- so this is upstream's own threading contract, not a new one.
    * it patches ``subprocess.Popen`` for the whole process for the duration of
      the block.  It is deliberately opt-in and scoped; nothing installs it
      globally.
    """

    def __init__(self, prefix: str = "") -> None:
        self.prefix = prefix
        self.captured = 0
        self._saved: Any = None

    def __enter__(self) -> "capture_children":
        outer = self
        real = subprocess.Popen
        self._saved = real

        class _Popen(real):  # type: ignore[misc,valid-type]
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                # ``Popen(args, bufsize, executable, stdin, stdout, stderr, ...)``:
                # a caller that passed stdout/stderr POSITIONALLY has already
                # made its choice and must not be second-guessed.
                patch = (
                    len(args) < 5
                    and kwargs.get("stdout") is None
                    and kwargs.get("stderr") is None
                )
                if patch:
                    kwargs["stdout"] = subprocess.PIPE
                    kwargs["stderr"] = subprocess.STDOUT
                super().__init__(*args, **kwargs)
                if patch and self.stdout is not None:
                    outer.captured += 1
                    _Drainer(self.stdout, outer.prefix).start()
                    # The drain thread owns the pipe now.  Hand the caller back
                    # the None it asked for, so `p.communicate()` / `p.wait()`
                    # behave exactly as they would have unpatched.
                    self.stdout = None

        subprocess.Popen = _Popen  # type: ignore[misc]
        return self

    def __exit__(self, *exc_info: Any) -> None:
        subprocess.Popen = self._saved  # type: ignore[misc]


def _self_check() -> None:  # pragma: no cover - developer convenience
    print(sys.version)
    print(execute([sys.executable, "-c", "print('hi')"]))
