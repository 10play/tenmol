"""WP-19 (keyboard shortcuts) — persisting the shortcut table.

`00-parity-inventory.md` row "Keyboard Shortcut Menu: create / delete / reset /
reset-all / save" ends in a Save button. Qt's is
`shortcut_menu_gui.py` -> `pymol.save_shortcut.save_shortcuts(dict)`, which
writes `~/.pymol/shortcuts_save.json`; `load_and_set` reads it back at startup
so the bindings survive a restart.

Measured before this grant, the Save button in `features/shortcuts` answered::

    'save_shortcut' is not an addressable namespace

`save_shortcut` is a real module under `modules/pymol/`, but it is not in
`DEFAULT_ROOTS`, and unlike some other gaps there is NO alternative route to
it — the file path is computed inside the module (`_SHORTCUTS_SAVE_FILE`
expanded through `expandvars`/`expanduser`), so a client cannot reproduce the
behaviour by writing the file itself without hard-coding a path that upstream
is free to change.

WHY SYMBOLS AND NOT THE ROOT: the module has five functions and the panel needs
three. `setkey_from_dict(save_dict, cmd)` and `load_and_set(cmd)` both take a
`cmd` object as an argument, which is not a thing a browser can pass; granting
them would put two permanently-unusable symbols on the wire. The three here are
plain data in, plain data out:

    get_shortcut_save_filename()   -> str, so the panel can SAY where it saved
    save_shortcuts(dict)           -> writes the JSON
    load_shortcuts_dict()          -> reads it back

`save_shortcuts` writes to the user's home directory, which makes it dangerous
in the policy's sense; it is declared as such so the confirmation path applies
rather than being silently exempt. That matches `cmd.png` and the other
filesystem writes, and it is a local desktop replacement, so writing there is
the intended behaviour and not an escape.
"""

from __future__ import annotations

# Absolute, not relative: grant files are loaded by PATH under a synthetic
# module name (`policy/__init__.py:_load_grant_file`), so `__package__` is not
# `tenmol_bridge.policy.grants` and a relative import would resolve elsewhere.
from tenmol_bridge.policy.base import Grant

GRANT = Grant(
    wp="WP-19",
    note="shortcut persistence: pymol.save_shortcut (modules/pymol/save_shortcut.py)",
    symbols={
        "save_shortcut.get_shortcut_save_filename",
        "save_shortcut.save_shortcuts",
        "save_shortcut.load_shortcuts_dict",
    },
    dangerous={
        "save_shortcut.save_shortcuts": (
            "writes ~/.pymol/shortcuts_save.json"
        ),
    },
)
