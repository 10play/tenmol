"""Read the LIVE key bindings, which no `cmd.*` call can return.

`cmd.key_mappings` is a plain dict attribute, and the dispatcher resolves
CALLABLES only (`dispatch.py`), so `{t:'call'}` cannot fetch it — it answers
"cmd.key_mappings is not callable". The shortcut editor therefore seeded its
table from the mirrored DEFAULT table and could only track edits made in that
session.

That made its Refresh button dishonest: the tooltip promises "refresh the table
to reflect any external changes", and it could not see a single external change
— a `set_key` from the command line, a pymolrc, or a plugin was invisible.

WHY THE VALUES NEED WORK. A mapping value is either a command STRING or a
`(function, args, kwargs)` tuple whose first element is a live Python callable.
The callable cannot cross the wire, and `repr()`-ing it would put a memory
address in the UI. Each entry is reduced to something a table can render and a
human can recognise, with the KIND stated so the editor knows an entry is not
editable as text.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

ATTR = "tenmol_shortcuts"


def _describe(value: Any) -> Dict[str, Any]:
    """One binding, as `{kind, command, callable}`.

    `kind` is `command` when the binding is a PML/Python string the editor may
    show and edit, and `callable` when it is a Python function that only exists
    inside this process.
    """
    if isinstance(value, str):
        return {"kind": "command", "command": value, "callable": None}

    if isinstance(value, (tuple, list)) and value:
        fn = value[0]
        if isinstance(fn, str):
            return {"kind": "command", "command": fn, "callable": None}
        name = getattr(fn, "__name__", None) or type(fn).__name__
        return {"kind": "callable", "command": "", "callable": str(name)}

    if callable(value):
        name = getattr(value, "__name__", None) or type(value).__name__
        return {"kind": "callable", "command": "", "callable": str(name)}

    # Anything else: show it, but never a raw repr with an address in it.
    text = str(value)
    return {
        "kind": "command",
        "command": "<opaque>" if " at 0x" in text else text,
        "callable": None,
    }


class ShortcutsAPI:
    def __init__(self, cmd: Any) -> None:
        self._cmd = cmd

    def hello(self) -> Dict[str, Any]:
        return {"ok": True, "attr": ATTR}

    def key_mappings(self) -> Dict[str, Any]:
        """Every live binding, keyed exactly as `set_key` spells it.

        Returned as a LIST of records rather than a dict so the order is
        stable and the client does not have to re-sort a mapping whose key
        order Python does not promise across builds.
        """
        mappings = getattr(self._cmd, "key_mappings", None) or {}
        entries: List[Dict[str, Any]] = []
        for key in sorted(mappings):
            entry = _describe(mappings[key])
            entry["key"] = key
            entries.append(entry)
        return {"ok": True, "count": len(entries), "entries": entries}


def install(cmd: Optional[Any] = None) -> Dict[str, Any]:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    existing = getattr(cmd, ATTR, None)
    if isinstance(existing, ShortcutsAPI):
        return existing.hello()
    api = ShortcutsAPI(cmd)
    setattr(cmd, ATTR, api)
    return api.hello()


def uninstall(cmd: Optional[Any] = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    if getattr(cmd, ATTR, None) is None:
        return False
    delattr(cmd, ATTR)
    return True


def installed(cmd: Optional[Any] = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    return isinstance(getattr(cmd, ATTR, None), ShortcutsAPI)
