"""Wave 11 — two launcher/packaging remainders, measured on real artefacts.

  ``00:77``   application startup: nothing ever READ ``shutdown_requested``, so
              neither ``cmd.quit`` nor the idle watchdog could stop the process
              (``bridge/tenmol_bridge/__main__.py`` called ``uvicorn.run()``),
              and nothing could set ``idle_shutdown_seconds`` from a launcher.
  ``00:203``  setting defaults: ``panels/setting_catalog.json`` is checked in and
              claimed to "travel with the package".  It did not — a built wheel
              held 43 ``.py`` files and ZERO ``.json``, because
              ``bridge/pyproject.toml`` declared no package-data.

WHY EVERY TEST HERE IS OUT-OF-PROCESS.  Both rows are about what happens to a
*process* — one that must exit, one that must be installed somewhere other than
this checkout.  The bridge suite shares a single PyMOL and a single uvicorn
(``conftest.py``), and neither can be killed or re-installed to find out.  So
these tests spawn their own bridges (with ``--no-gl`` or ``--no-pymol``, never
touching the session engine) and build their own wheels in ``tmp_path``.  The
one thing an in-process test CANNOT see is precisely the thing that was broken:
the wave-10 packaging test monkeypatched ``setting_info_path`` to None while
still running out of the source tree, so the asset was always on disk next to
the module and its absence in an install was invisible.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import zipfile
from typing import Any, Dict, List, Optional

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BRIDGE_DIR = os.path.join(REPO, "bridge")
ASSET = os.path.join(BRIDGE_DIR, "tenmol_bridge", "panels", "setting_catalog.json")


# ---------------------------------------------------------------------------
# 00:77 — the launcher line: shutdown_requested -> the process actually stops
# ---------------------------------------------------------------------------


class _FakeBridge:
    """Just the two attributes :class:`ShutdownWatcher` reads."""

    def __init__(self) -> None:
        self.shutdown_requested = False
        self.shutdown_reason: Optional[str] = None


class _FakeUvicorn:
    def __init__(self) -> None:
        self.should_exit = False


def test_the_watcher_turns_the_flag_into_uvicorn_should_exit() -> None:
    """``request_shutdown()`` -> ``Server.should_exit``, within one interval.

    This is the wire the row said was missing.  ``uvicorn.run()`` blocks and
    reads nothing back, so ``cmd.quit`` (routed to
    ``BridgeServer.request_shutdown``, ``policy/base.py:166``) and the idle
    watchdog both set a boolean nobody consulted.
    """
    from tenmol_bridge.__main__ import ShutdownWatcher

    bridge = _FakeBridge()
    uvicorn_server = _FakeUvicorn()
    watcher = ShutdownWatcher(bridge, uvicorn_server, interval=0.02).start()
    try:
        # Nothing asked for a shutdown: the watcher must sit still.  A watcher
        # that fired on its own would kill `pnpm dev` on every page reload.
        time.sleep(0.2)
        assert uvicorn_server.should_exit is False
        assert watcher.fired is False

        bridge.shutdown_reason = "cmd.quit"
        started = time.monotonic()
        bridge.shutdown_requested = True
        deadline = started + 2.0
        while time.monotonic() < deadline and not uvicorn_server.should_exit:
            time.sleep(0.002)
        latency = time.monotonic() - started
    finally:
        watcher.stop()

    assert uvicorn_server.should_exit is True
    assert watcher.fired is True
    # Measured on this machine at interval=0.02, eight runs: 13.4-20.9 ms.
    # The bound is three intervals, still two orders of magnitude under the
    # 20 s WebSocket ping timeout that notices a suspended machine.
    assert latency < 0.06, latency
    watcher.join(timeout=2.0)


def test_stopping_the_watcher_stops_it_reading_the_flag() -> None:
    """``stop()`` before the flag is set means uvicorn is never touched.

    The watcher outlives ``uvicorn_server.run()`` returning for its own reasons
    (a signal, a bind failure); ``main()`` stops it in a ``finally``.
    """
    from tenmol_bridge.__main__ import ShutdownWatcher

    bridge = _FakeBridge()
    uvicorn_server = _FakeUvicorn()
    watcher = ShutdownWatcher(bridge, uvicorn_server, interval=0.02).start()
    watcher.stop()
    watcher.join(timeout=2.0)
    bridge.shutdown_requested = True
    time.sleep(0.15)
    assert uvicorn_server.should_exit is False
    assert watcher.fired is False


def test_the_idle_shutdown_flag_parses_and_defaults_to_unset() -> None:
    """``--idle-shutdown`` exists and, unset, changes nothing.

    ``None`` rather than ``0.0`` matters: the launcher must leave
    ``TENMOL_BRIDGE_IDLE_SHUTDOWN`` alone when the flag is absent, and override
    it (including back to "off") when it is present.
    """
    from tenmol_bridge.__main__ import build_parser

    parser = build_parser()
    assert parser.parse_args([]).idle_shutdown is None
    assert parser.parse_args(["--idle-shutdown", "0"]).idle_shutdown == 0.0
    assert parser.parse_args(["--idle-shutdown", "12.5"]).idle_shutdown == 12.5


# -- out-of-process bridges -------------------------------------------------


class _Spawned:
    """A ``python -m tenmol_bridge`` process on its own port."""

    def __init__(self, args: List[str], env: Optional[Dict[str, str]] = None) -> None:
        import socket

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = int(probe.getsockname()[1])
        environ = dict(os.environ)
        environ.setdefault("PYTHONUNBUFFERED", "1")
        if env:
            environ.update(env)
        self.log_path: Optional[str] = None
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "tenmol_bridge", "--port", str(self.port), *args],
            cwd=REPO,
            env=environ,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

    @property
    def base_url(self) -> str:
        return "http://127.0.0.1:%d" % self.port

    def healthz(self, timeout: float = 5.0) -> Dict[str, Any]:
        with urllib.request.urlopen(self.base_url + "/healthz", timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def wait_until_up(self, timeout: float = 90.0) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise AssertionError("bridge died during startup:\n" + self.output())
            try:
                return self.healthz()
            except (urllib.error.URLError, OSError):
                time.sleep(0.05)
        raise AssertionError("bridge never answered /healthz:\n" + self.output())

    def connect(self) -> Any:
        from websockets.sync.client import connect

        client = connect("ws://127.0.0.1:%d/ws" % self.port, open_timeout=20)
        client.recv(timeout=20)  # hello
        return client

    def output(self) -> str:
        try:
            return self.proc.communicate(timeout=5)[0] or ""
        except Exception:  # noqa: BLE001
            return "<no output>"

    def kill(self) -> None:
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:  # pragma: no cover
                self.proc.kill()


def test_cmd_quit_now_stops_the_process() -> None:
    """File ▸ Quit -> the process is gone, gracefully.

    ``execapp``'s File ▸ Quit is ``QApplication.quit()`` and its ``closeEvent``
    is ``cmd.quit()`` (``pymol_qt_gui.py:1193``); both end the process.  Here
    ``cmd.quit`` was ROUTED away from PyMOL's C ``exit()`` (correct — it would
    skip ``atexit`` and flush nothing) into a flag, and then the flag was
    dropped on the floor.  ``--no-pymol`` because the routed ``quit`` never
    reaches the engine (``policy/base.py:166``), which keeps this test at about
    a second.
    """
    bridge = _Spawned(["--no-pymol", "--no-token", "--log-level", "warning"])
    try:
        bridge.wait_until_up()
        client = bridge.connect()
        client.send(json.dumps({"id": 1, "t": "call", "fn": "cmd.quit", "args": []}))
        reply = json.loads(client.recv(timeout=10))
        assert reply["t"] == "ok", reply
        assert reply["result"] == {"routed": "cmd.quit", "shutdown": True}
        started = time.monotonic()
        code = bridge.proc.wait(timeout=20)
        elapsed = time.monotonic() - started
    finally:
        bridge.kill()

    # Graceful: uvicorn's own shutdown ran, so lifespan shutdown ran, so
    # `BridgeServer.stop()` ran.  `os._exit` would give a non-zero code here.
    assert code == 0, code
    # Measured on this machine, three runs: 0.228 / 0.233 / 0.234 s from the
    # reply to the process being gone (one 0.1 s watcher tick plus uvicorn's
    # graceful close).  A generous ceiling; the point is that it terminates.
    assert elapsed < 5.0, elapsed


@pytest.mark.engine
def test_the_idle_watchdog_stops_the_process_after_the_browser_goes_away() -> None:
    """A closed tab -> the engine stops.  The whole row-77 shutdown story.

    A real engine (``--no-gl``: no window server needed, ~0.2 s to boot) because
    the liveness sweep rides the 10 Hz STATUS thread, which only runs when the
    pump runs — with ``--no-pymol`` the watchdog can never fire, which is itself
    worth knowing and is why this test does not take that shortcut.
    """
    grace = 0.8
    bridge = _Spawned(
        [
            "--no-gl",
            "--no-token",
            "--idle-shutdown",
            str(grace),
            "--log-level",
            "warning",
        ]
    )
    try:
        health = bridge.wait_until_up()
        assert health["state"] == "headless", health["state"]
        assert health["liveness"]["idleShutdownSeconds"] == grace
        # Armed only by a client that HAS connected: an engine nobody ever
        # opened a browser onto must not quit under a developer's feet.
        assert health["liveness"]["armed"] is False
        assert health["liveness"]["clientsEver"] == 0

        client = bridge.connect()
        assert bridge.healthz()["liveness"]["clients"] == 1
        client.close()
        started = time.monotonic()
        code = bridge.proc.wait(timeout=30)
        elapsed = time.monotonic() - started
        output = bridge.output()
    finally:
        bridge.kill()

    assert code == 0, code
    # The grace period is REAL: it waited it out before deciding.
    assert elapsed >= grace, elapsed
    # ... and then acted promptly: measured 1.139 / 1.142 / 1.140 s for
    # grace=0.8, i.e. 0.34 s of 10 Hz sweep, 0.1 s watcher tick and uvicorn's
    # graceful close on top of the grace period.
    assert elapsed < grace + 3.0, elapsed
    assert "no client for" in output, output
    assert "the browser is gone" in output, output


@pytest.mark.engine
def test_idle_shutdown_is_off_by_default_so_a_client_free_bridge_survives() -> None:
    """The default must NOT quit: ``pnpm dev`` reloads the page constantly and
    this suite leaves the engine client-free for minutes at a time.

    Measured over seconds, not inferred: the engine's idle loop runs at 60 Hz
    with no client at all (``engine.py:236``), so "nothing happens" is not a
    claim that can be made from source.
    """
    bridge = _Spawned(["--no-gl", "--no-token", "--log-level", "warning"])
    try:
        health = bridge.wait_until_up()
        assert health["liveness"]["idleShutdownSeconds"] == 0.0
        client = bridge.connect()
        client.close()
        time.sleep(2.5)
        assert bridge.proc.poll() is None, "the bridge quit with the watchdog off"
        health = bridge.healthz()
        assert health["shutdownRequested"] is False
        assert health["shutdownReason"] is None
        assert health["liveness"]["clients"] == 0
        assert health["liveness"]["armed"] is True
        # It knows the browser is gone and is deliberately doing nothing.
        assert health["liveness"]["idleSeconds"] >= 2.0, health["liveness"]
    finally:
        bridge.kill()


def test_the_flag_overrides_the_environment_in_both_directions() -> None:
    """``--idle-shutdown`` beats ``TENMOL_BRIDGE_IDLE_SHUTDOWN``, including to 0.

    ``--no-pymol``: this reads the number back out of ``/healthz`` and never
    needs the watchdog to fire.
    """
    env = {"TENMOL_BRIDGE_IDLE_SHUTDOWN": "7"}
    from_env = _Spawned(["--no-pymol", "--no-token", "--log-level", "warning"], env)
    try:
        assert from_env.wait_until_up()["liveness"]["idleShutdownSeconds"] == 7.0
    finally:
        from_env.kill()

    overridden = _Spawned(
        ["--no-pymol", "--no-token", "--idle-shutdown", "0", "--log-level", "warning"],
        env,
    )
    try:
        assert overridden.wait_until_up()["liveness"]["idleShutdownSeconds"] == 0.0
    finally:
        overridden.kill()


# ---------------------------------------------------------------------------
# 00:203 — the build-time asset has to be IN the distribution
# ---------------------------------------------------------------------------


def _copy_project(dest: str) -> str:
    """A clean copy of the distribution's inputs — no ``build/``, no egg-info.

    Building in-place would reuse ``bridge/build/``, which is exactly how the
    "it is in the wheel" claim survived: a stale tree can carry files the
    declaration no longer produces.
    """
    os.makedirs(dest, exist_ok=True)
    for name in ("pyproject.toml", "README.md"):
        shutil.copy2(os.path.join(BRIDGE_DIR, name), os.path.join(dest, name))
    shutil.copytree(
        os.path.join(BRIDGE_DIR, "tenmol_bridge"),
        os.path.join(dest, "tenmol_bridge"),
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info", "build"),
    )
    return dest


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Dict[str, str]:
    """Run the project's own PEP 517 hooks and hand back the two artefacts.

    In a subprocess because ``setuptools.build_meta`` monkeypatches distutils
    and chdirs; this process is shared with PyMOL and 1700 other tests.
    """
    root = _copy_project(str(tmp_path_factory.mktemp("dist-src")))
    out = os.path.join(root, "_out")
    os.makedirs(out, exist_ok=True)
    script = (
        "import json, sys\n"
        "from setuptools import build_meta\n"
        "print(json.dumps({'wheel': build_meta.build_wheel(%r),"
        " 'sdist': build_meta.build_sdist(%r)}))\n" % (out, out)
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-4000:]
    names = json.loads(proc.stdout.strip().splitlines()[-1])
    return {
        "root": root,
        "wheel": os.path.join(out, names["wheel"]),
        "sdist": os.path.join(out, names["sdist"]),
    }


def test_a_built_wheel_actually_contains_the_setting_catalog_asset(
    built: Dict[str, str],
) -> None:
    """The sentence the row turns on, checked against a real artefact.

    Before ``[tool.setuptools.package-data]`` existed this wheel held 43 ``.py``
    files and no ``.json`` at all: setuptools ships ``*.py`` and nothing else
    unless told.  Delete the stanza from ``bridge/pyproject.toml`` and this test
    goes red (mutation-tested).
    """
    with zipfile.ZipFile(built["wheel"]) as wheel:
        names = wheel.namelist()
        assert "tenmol_bridge/panels/setting_catalog.json" in names, sorted(names)
        shipped = wheel.read("tenmol_bridge/panels/setting_catalog.json")
    with open(ASSET, "rb") as handle:
        checked_in = handle.read()
    # Byte-identical, not merely present: `load_asset()` rejects the document on
    # a version or shape mismatch and then reports NO defaults.
    assert shipped == checked_in
    assert len(shipped) == os.path.getsize(ASSET)
    # A sanity floor on the build itself, so "the asset is there" cannot be
    # satisfied by an empty wheel.
    assert len([n for n in names if n.endswith(".py")]) >= 40, len(names)


def test_the_sdist_carries_it_too(built: Dict[str, str]) -> None:
    """package-data reaches the source distribution as well, with no MANIFEST.in.

    An sdist is what a distro or a `pip install .` from a tarball builds from;
    if the asset were wheel-only, rebuilding from the sdist would quietly
    produce a wheel without it.
    """
    with tarfile.open(built["sdist"]) as sdist:
        names = sdist.getnames()
    assert any(n.endswith("tenmol_bridge/panels/setting_catalog.json") for n in names), (
        [n for n in names if n.endswith(".json")]
    )


def _isolated_probe(target: str, code: str) -> Dict[str, Any]:
    """Run ``code`` against an installed layout with NOTHING else on the path.

    ``-S -I``: no ``site``, so the editable install of ``tenmol_bridge`` in this
    venv (a ``sys.meta_path`` finder, ``__editable___tenmol_bridge_0_1_0_finder``,
    which would win over any ``sys.path`` entry) cannot answer the import, and
    no environment variable can redirect it.  This is the closest thing to
    ``pip install tenmol-bridge`` on another machine that a test can be.
    """
    script = "import sys, json\nsys.path.insert(0, %r)\n%s" % (target, code)
    proc = subprocess.run(
        [sys.executable, "-S", "-I", "-c", script],
        cwd=os.path.dirname(target),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr[-4000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_an_installed_layout_finds_the_asset_and_no_source_tree(
    built: Dict[str, str], tmp_path: Any
) -> None:
    """Unpack the wheel and read the catalogue the way an install would.

    THE MEASUREMENT THE OLD TEST COULD NOT MAKE.  It monkeypatched
    ``setting_info_path`` to None while running out of this checkout, so the
    asset was always next to the module.  Here the module IS the installed copy
    (asserted), the header genuinely is not present (``layer1/SettingInfo.h`` is
    not in any distribution), and the asset is what supplies 798 records.
    """
    target = str(tmp_path / "site-packages")
    os.makedirs(target)
    with zipfile.ZipFile(built["wheel"]) as wheel:
        wheel.extractall(target)

    probe = _isolated_probe(
        target,
        "import tenmol_bridge.panels.settings as s\n"
        "d = s.load_asset()\n"
        "print(json.dumps({\n"
        "  'module': s.__file__,\n"
        "  'asset': s.asset_path(),\n"
        "  'header': s.setting_info_path(),\n"
        "  'records': len(d['records']) if d else 0,\n"
        "  'help': len(d['help']) if d else 0,\n"
        "  'defaults': sum(1 for r in (d['records'] if d else []) if 'default' in r),\n"
        "}))\n",
    )
    assert probe["module"].startswith(target), probe["module"]
    assert probe["asset"] == os.path.join(
        target, "tenmol_bridge", "panels", "setting_catalog.json"
    )
    # The header is a SOURCE file. No wheel, no conda package and no
    # `pip install pymol` ships it, and `setting_info_path()` only looks next to
    # this repository — which is the entire reason the asset exists.
    assert probe["header"] is None
    assert probe["records"] == 798
    assert probe["help"] == 697
    assert probe["defaults"] == 798


def test_without_the_asset_the_same_install_has_no_defaults_at_all(
    built: Dict[str, str], tmp_path: Any
) -> None:
    """The counterfactual, in the same layout: delete the file, lose everything.

    This is the state every installed bridge was in before the packaging fix —
    ``load_asset()`` None, no defaults, no ranges, no help — and it is what the
    ``pyproject.toml`` stanza buys.
    """
    target = str(tmp_path / "site-packages")
    os.makedirs(target)
    with zipfile.ZipFile(built["wheel"]) as wheel:
        wheel.extractall(target)
    victim = os.path.join(target, "tenmol_bridge", "panels", "setting_catalog.json")
    assert os.path.isfile(victim), "the wheel did not ship the asset to delete"
    os.remove(victim)

    probe = _isolated_probe(
        target,
        "import tenmol_bridge.panels.settings as s\n"
        "d = s.load_asset()\n"
        "print(json.dumps({'asset': s.asset_path(), 'header': s.setting_info_path(),\n"
        "                  'loaded': d is not None}))\n",
    )
    assert probe["asset"] is None
    assert probe["header"] is None
    assert probe["loaded"] is False
