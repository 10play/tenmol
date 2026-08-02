"""Parity area 4 — double-click and single-click detection.

Both rows are about TIMING that PyMOL measures itself, and the client's job is
mostly to stay out of the way. The constants are asserted from the C source
rather than transcribed, and the one thing a client genuinely cannot fix is
pinned so nobody tries.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_click_timing.py -q
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCENE_MOUSE = os.path.join(REPO, "packages", "engine", "layer1", "SceneMouse.cpp")
SCENE = os.path.join(REPO, "packages", "engine", "layer1", "Scene.cpp")
CMD_CPP = os.path.join(REPO, "packages", "engine", "layer4", "Cmd.cpp")
BLOCK_H = os.path.join(REPO, "packages", "engine", "layer0", "Block.h")


def source(path: str) -> str:
    return open(path, encoding="utf-8", errors="replace").read()


# ------------------------------------------------------------ the constants


def test_the_double_click_window_is_035s_and_10px() -> None:
    """`cDoubleTime` and the pixel box, from the source not from memory."""
    text = source(SCENE_MOUSE)
    assert "#define cDoubleTime 0.35" in text
    assert re.search(r"\(dx < 10\) && \(dy < 10\) && \(I->LastButton == button\)", text), (
        "the 10px / same-button test changed"
    )


def test_the_single_click_windows_are_025_and_015() -> None:
    text = source(SCENE_MOUSE)
    assert "double slowest_single_click = 0.25F;" in text
    assert "I->SingleClickDelay = 0.15;" in text
    assert "double slowest_single_click_drag = 0.15;" in text
    # The render time is ADDED to the window — so a slow frame widens it.
    assert "slowest_single_click += I->ApproxRenderTime;" in text


# --------------------------------------- the timestamp a client cannot supply


def test_the_click_timestamp_is_taken_from_the_SERVER_clock() -> None:
    """The row proposes sending client timestamps as `when`. It cannot work.

    The chain, each link asserted:

        Cmd_Button          PyArg_ParseTuple(args, "Oiiiii", ...)
                            button, state, x, y, modifiers — SIX values, no time
        Block::click        virtual int click(int button, int x, int y, int mod)
                            no `when` parameter at all
        CScene::click       SceneDeferClickWhen(..., UtilGetSeconds(m_G), ...)
                            the clock is read HERE, in the core

    So the press-to-release gap PyMOL measures includes the full network round
    trip, and on a slow link a genuine single click exceeds
    0.25 s + ApproxRenderTime and is silently dropped. There is no client-side
    fix and no bridge-side fix — it needs a C change. Pinned so the row's
    suggested mitigation is not attempted and quietly abandoned.
    """
    cmd_cpp = source(CMD_CPP)
    assert 'PyArg_ParseTuple(args, "Oiiiii"' in cmd_cpp, "Cmd_Button's arity changed"

    block_h = source(BLOCK_H)
    assert "virtual int click(int button, int x, int y, int mod)" in block_h

    scene = source(SCENE)
    assert "SceneDeferClickWhen(this, button, x, y, UtilGetSeconds(m_G), mod)" in scene


# ------------------------------------------------- what the client must not do


def test_the_client_never_synthesises_a_double_click() -> None:
    """PyMOL promotes a pair to a double click itself; a browser must not.

    If the client also sent a synthesised `dblclick`, the backend would see
    three presses for two physical clicks and the second one would promote
    again. Asserted by absence across the input code, which is crude but
    exactly the check that matters — there is no positive artefact to look at.
    """
    roots = [
        os.path.join(REPO, "packages", "viewport", "src"),
        os.path.join(REPO, "apps", "web", "src"),
    ]
    result = subprocess.run(
        ["grep", "-rn", "-e", "dblclick", "-e", "ondblclick"] + roots,
        capture_output=True,
        text=True,
    )
    offenders = [
        line
        for line in result.stdout.splitlines()
        if ".test." not in line and "/__fixtures__/" not in line
    ]
    assert offenders == [], offenders


def test_the_client_sends_a_state_per_press_and_release(ws) -> None:
    """Down and up are separate frames; the backend pairs them.

    `{t:'input', kind:'button'}` carries `state` — 0 down, 1 up — and PyMOL
    does the pairing. A client that only sent completed clicks would make
    every drag impossible.
    """
    reply = ws.request(t="input", kind="button", button=0, state=0, x=10, y=10, mod=0)
    assert reply["t"] == "ok", reply
    reply = ws.request(t="input", kind="button", button=0, state=1, x=10, y=10, mod=0)
    assert reply["t"] == "ok", reply
