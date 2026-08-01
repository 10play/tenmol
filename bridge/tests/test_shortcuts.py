"""Parity area 10 — the Keyboard Shortcut Menu, engine side.

The client-side half (key-event translation, the validator, the default table)
lives in `packages/viewport/src/input/keys.ts` and is unit-tested next to it.
This file pins the OTHER half: what `cmd.set_key` actually accepts and what
delete / reset actually do, so the two cannot drift apart silently.

`keys.test.ts` carries the same accept/refuse table with the engine's own error
messages in comments. If PyMOL's validation ever changes, this file fails and
that one becomes a lie — which is the point of having both.

Run::

    bridge/.venv/bin/python -m pytest bridge/tests/test_shortcuts.py -q
"""

from __future__ import annotations

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import WSClient  # noqa: E402

CMD = 'print("tenmol shortcut probe")'

#: Measured against a live engine. Mirrored in `keys.test.ts`.
ACCEPTED = (
    "CTRL-A", "CTSH-A", "ALT-A",
    "F1", "CTRL-F1",
    # SHFT is refused with a regular LETTER but fine with an F-key.
    "SHFT-F1",
    "pgup", "pgdn", "home", "insert",
    "up", "down", "left", "right", "end",
    "CTRL-pgup",
)

#: ``(key, the substring PyMOL's own message contains)``.
REFUSED = (
    ("SHFT-A", "Can't map regular letters with SHFT"),
    ("A", "Can't map regular letters"),
    ("a", "Can't map regular letters"),
    ("BOGUS-A", "not a valid modifier key"),
    ("nonesuch", "special 'nonesuch' key not found"),
    ("CTRL-nonesuch", "special 'nonesuch' key not found"),
    # Not a PyMOL special key at all, despite being an obvious thing to try.
    ("escape", "special 'escape' key not found"),
)


@pytest.mark.parametrize("key", ACCEPTED)
def test_set_key_accepts(ws: WSClient, key: str) -> None:
    assert ws.call_reply("cmd.set_key", key, CMD)["t"] == "ok", key


@pytest.mark.parametrize("key,message", REFUSED)
def test_set_key_refuses(ws: WSClient, key: str, message: str) -> None:
    reply = ws.call_reply("cmd.set_key", key, CMD)
    assert reply["t"] == "err", (key, reply)
    assert message in reply["error"]["message"], (key, reply["error"]["message"])


def test_set_key_returns_none_not_a_success_flag(ws: WSClient) -> None:
    """The editor must not treat the return value as an outcome.

    `set_key` answers None on success and RAISES on refusal, so a client that
    checked the result would call every binding a failure.
    """
    assert ws.call("cmd.set_key", "CTRL-A", CMD) is None


def test_a_binding_lands_in_the_key_mappings_table(ws: WSClient) -> None:
    """`cmd.key_mappings` is what the editor's table reconciles against."""
    ws.call("cmd.set_key", "CTRL-A", CMD)
    mappings = ws.call("cmd.get_key_mappings") if _has(ws, "get_key_mappings") else None
    if mappings is None:
        pytest.skip("no get_key_mappings in this build; table read is client-side")
    assert "CTRL-A" in mappings


def _has(ws: WSClient, leaf: str) -> bool:
    return ws.call_reply("cmd." + leaf)["t"] == "ok"


def test_delete_is_set_key_with_an_empty_command(ws: WSClient) -> None:
    """`delete_selected` (`shortcut_menu_gui.py`) unbinds with `set_key(key,'')`.

    It must be ACCEPTED rather than refused as an empty command, or the Delete
    button in the editor is dead.
    """
    ws.call("cmd.set_key", "CTRL-A", CMD)
    assert ws.call_reply("cmd.set_key", "CTRL-A", "")["t"] == "ok"


def test_reset_is_set_key_with_the_default_command(ws: WSClient) -> None:
    """`reset_selected` rebinds the default; nothing special-cased about it."""
    assert ws.call_reply("cmd.set_key", "CTSH-R", "h_fill")["t"] == "ok"


def test_a_bound_key_runs_when_the_key_is_actually_PRESSED(ws: WSClient) -> None:
    """The binding executes, driven the way the browser drives it.

    Not `ws.do("delete ...")` — that would only prove `delete` works. The key
    goes in as a `{t:'input', kind:'button'}` frame with the ASCII state, the
    same envelope `KeyboardService.tsx` sends, so this covers set_key AND the
    input path that has to reach PyMOL's key handler.

    The code is 1, NOT 65: with Ctrl held, `keyEventToButtonArgs` sends
    `upper - 64` (`keys.ts`, mirroring `keymapping.py:88`). Sending 65 makes
    `OrthoKey` insert the letter into the command line instead of invoking the
    binding — which is exactly what happened when this test was first written,
    and is the whole reason the client does the subtraction.

    `KEY_STATE_ASCII` is -1 and CTRL is mask 2.
    """
    ws.call("cmd.fragment", "ala", "zz_key_probe")
    try:
        ws.call("cmd.set_key", "CTRL-A", "delete zz_key_probe")
        assert "zz_key_probe" in ws.call("cmd.get_names", "all")

        ws.input("button", button=1, state=-1, x=0, y=0, mod=2, when=0.0)

        # Input is QUEUED (`OrthoDefer`) and drained by a draw, so the effect
        # is not synchronous with the frame. Poll rather than sleep a guess.
        for _ in range(40):
            if "zz_key_probe" not in ws.call("cmd.get_names", "all"):
                break
            time.sleep(0.05)
        assert "zz_key_probe" not in ws.call("cmd.get_names", "all"), (
            "CTRL-A was bound but pressing it did nothing"
        )
    finally:
        ws.call("cmd.set_key", "CTRL-A", "")
        ws.call("cmd.delete", "zz_key_probe")


# =========================================================================== #
# Persistence — the Save button
# =========================================================================== #


def test_the_save_module_is_reachable(ws: WSClient) -> None:
    """Before `policy/grants/wp-19-shortcuts.py`, this answered
    "'save_shortcut' is not an addressable namespace" and the Save button in
    `features/shortcuts` was dead.
    """
    name = ws.call("save_shortcut.get_shortcut_save_filename")
    assert isinstance(name, str) and name.endswith("shortcuts_save.json"), name
    # Expanded server-side: the client must not be reproducing this path.
    assert "~" not in name and "$" not in name, name


def test_the_grant_did_not_open_the_whole_module(ws: WSClient) -> None:
    """`setkey_from_dict`/`load_and_set` take a `cmd` object nothing can send."""
    from tenmol_bridge.policy import build_policy

    policy = build_policy()
    for allowed in (
        "save_shortcut.get_shortcut_save_filename",
        "save_shortcut.save_shortcuts",
        "save_shortcut.load_shortcuts_dict",
    ):
        assert policy.check(allowed).allowed, allowed
    for refused in ("save_shortcut.setkey_from_dict", "save_shortcut.load_and_set"):
        assert not policy.check(refused).allowed, refused


def test_saving_is_declared_dangerous() -> None:
    """It writes to the user's home directory; the confirm path must apply."""
    from tenmol_bridge.policy import build_policy

    policy = build_policy()
    assert policy.check("save_shortcut.save_shortcuts").allowed
    reason = policy.dangerous.get("save_shortcut.save_shortcuts")
    assert reason is not None, "the grant stopped declaring it dangerous"
    assert "~/.pymol" in reason, reason
    # The two read-only symbols must NOT be dangerous, or every panel refresh
    # would drag a confirmation behind it.
    assert "save_shortcut.load_shortcuts_dict" not in policy.dangerous
    assert "save_shortcut.get_shortcut_save_filename" not in policy.dangerous


def test_shortcuts_round_trip_through_the_save_file(ws: WSClient) -> None:
    """Save then load, with the real file the panel writes.

    The existing file is read first and restored afterwards: this is the user's
    own `~/.pymol/shortcuts_save.json`, not a fixture.
    """
    before = ws.call("save_shortcut.load_shortcuts_dict")
    # THE SHAPE MATTERS. The file is `cmd.shortcut_dict`, whose values are
    # 3-element lists `[command, description, user_defined]`, and
    # `setkey_from_dict` replays element [2] — not the whole value
    # (`save_shortcut.py:57-62`). A flat `{key: "command"}` would survive this
    # round trip perfectly and then, at the next startup, `"command"[2]` would
    # be the character 'm': truthy, so PyMOL would silently bind the key to a
    # one-letter command. An earlier version of this test saved exactly that.
    probe = {"CTRL-A": ["print('a')", "user defined", "print('tenmol round trip')"]}
    try:
        ws.call("save_shortcut.save_shortcuts", probe)
        loaded = ws.call("save_shortcut.load_shortcuts_dict")
        assert loaded == probe
        # What startup will actually replay.
        assert loaded["CTRL-A"][2] == "print('tenmol round trip')"
    finally:
        # Restore unconditionally. `before` is falsy both when the file is
        # absent and when it holds `{}`; writing `{}` back means "no saved
        # shortcuts", which is what both of those meant — the alternative is
        # leaving a test binding in the user's real ~/.pymol file.
        ws.call("save_shortcut.save_shortcuts", before or {})
        assert ws.call("save_shortcut.load_shortcuts_dict") == (before or {})


def test_the_replayed_element_is_the_third_one(ws: WSClient) -> None:
    """`setkey_from_dict` binds `value[2]`, and skips a falsy one.

    `load_and_set` is NOT granted (it takes a `cmd` object no browser can
    send), so the replay itself is not reachable from here. What IS assertable
    is the contract the saved file must satisfy for that replay to work, and
    that the editor's own payload satisfies it — `ShortcutEditor.save()` builds
    `[command, description, userDefined]`, mirrored by a unit test beside it.
    """
    before = ws.call("save_shortcut.load_shortcuts_dict")
    try:
        # A binding the user cleared: `remove_unused` keeps it, replay skips it.
        probe = {
            "CTRL-A": ["orient", "default", "zoom"],
            "CTRL-E": ["ray", "default", ""],
        }
        ws.call("save_shortcut.save_shortcuts", probe)
        loaded = ws.call("save_shortcut.load_shortcuts_dict")
        replayed = {k: v[2] for k, v in loaded.items() if v[2]}
        assert replayed == {"CTRL-A": "zoom"}, replayed
    finally:
        ws.call("save_shortcut.save_shortcuts", before or {})
