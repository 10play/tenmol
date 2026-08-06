"""Setting introspection for the web client (WP-15).

WHAT THIS IS
------------
One place that answers the three questions the Setting menu and the advanced
settings table ask, and that PyMOL's Python surface cannot answer in bulk:

1. **What settings exist?**  ``catalogue()`` — every visible setting with its
   index, name, type, *level*, default, min/max and help text.
2. **What are they set to?**  ``values()`` — all 779 values (and their text
   renderings) in ONE round trip instead of 779.
3. **What just changed?**  ``drain()`` — the indices ``cmd.get_setting_updates()``
   reported, read from a TAP rather than from the drain itself.

Every number below was measured on this build (``packages/bridge/.venv``): 780
``cmd.get_setting_tuple`` calls take 0.5 ms, 780 ``cmd.get`` calls 0.5 ms and
780 ``_cmd.get_setting_level`` calls under 0.1 ms.  Doing them one per WebSocket
message would be 779 round trips for data that never changes.

THE LEVEL IS THE POINT
----------------------
``_cmd.get_setting_level(index)`` (``packages/engine/layer4/Cmd.cpp:4403-4409``) returns the
level NAME and is **never wrapped in** ``packages/engine/modules/pymol/setting.py`` — it is
reachable only as ``cmd._cmd.get_setting_level(i)``.  The level decides whether a
setting can be written globally, per object, per state or per atom, and a write
at the wrong level is a *warning that still performs a no-op write*
(``packages/engine/layer3/Executive.cpp:12279-12286``).  Without the level the UI would silently
offer scopes that do nothing.  This module is where it enters the web client.

THE UPDATE TAP (never a second consumer)
----------------------------------------
``cmd.get_setting_updates()`` (``packages/engine/layer1/Setting.cpp:1121-1147``) **clears the
changed flags while it iterates**: whoever reads first wins and everybody else
sees ``[]``.  The bridge's status thread already owns that call
(``tenmol_bridge/pump.py:451-458``), so this module does not call it.  It wraps
it: :func:`install` replaces ``cmd.get_setting_updates`` with a pass-through
that *records* what the status thread received and returns it unchanged.  The
number of consumers stays exactly one; the client reads the recording with a
cursor, so a slow client loses nothing (unlike a push it might miss).

Only the no-argument (global) call is recorded.  ``get_setting_updates(name,
state)`` targets one object's state-level CSetting — a different channel, which
the status thread does not poll and which is therefore not observable here.

DEFAULTS AND MIN/MAX
--------------------
There is **no** Python or C API for a setting's default or its min/max: the data
lives in the static C table ``SettingInfo[]`` and nothing exports it
(``feature-parity.md`` area 5 row 2 records this as a missing C++
accessor).  No API is invented here.  Instead the header that GENERATES that
table, ``packages/engine/layer1/SettingInfo.h``, is parsed — at BUILD time into
``panels/setting_catalog.json`` (:func:`build_asset`), and at run time straight
from the header when a source checkout is present and the asset is not.  Either
way the records are **rejected wholesale** unless every index agrees with the
live ``setting.index_dict`` name and with ``_cmd.get_setting_level(index)``.
When neither delivery survives, the catalogue reports ``defaultsSource: null``
and the UI ships unclamped inputs and says so.  PyMOL itself only clamps *int*
settings and only for global writes (``packages/engine/layer1/Setting.cpp:1890-1911``), so
client-side clamping would be a lie in both directions; the range is shown as a
hint and never enforced.

Help text comes from ``packages/engine/data/setting_help.csv`` (875 rows), which has **zero
consumers anywhere in the PyMOL tree** — this is its first one.  It is carried
in the same asset, because a ``pip install`` layout has the CSV (under
``$PYMOL_DATA``) but never the header.

HOW THE CLIENT REACHES IT
-------------------------
:func:`install` publishes six plain functions onto the ``pymol.setting``
module::

    setting.tenmol_settings_status()
    setting.tenmol_settings_catalogue()
    setting.tenmol_settings_values(indices, object, state)
    setting.tenmol_settings_scope(object, selection, state)
    setting.tenmol_settings_bonds(selection, selection2, state)
    setting.tenmol_settings_drain(cursor)

``setting`` is already an addressable namespace
(``tenmol_bridge/policy/base.py`` ``DEFAULT_ROOTS``) and none of these names is
private, so the ordinary ``{t:'call'}`` path reaches them with no policy change
and no edit to any file this work package does not own.  The client bootstraps
once per PyMOL process with::

    {t:'do', cmd: '/import tenmol_bridge.panels.settings as _s;_s.install()'}

(a leading ``/`` makes PyMOL execute the rest of the line as Python).  Both
:func:`install` and the bootstrap are idempotent.

A push-based ``settings`` topic would be strictly better and needs three lines
in ``BridgeServer._on_status`` (``server.py:145-154``), which already receives
``updates`` and drops it on the floor.  That file belongs to another work
package; until it forwards, the client polls :func:`drain`, and because the tap
is cumulative and cursor-addressed, polling it slowly is lossless.
"""

from __future__ import annotations

import csv
import json
import os
import re
import threading
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "KIND_BY_TYPE",
    "TYPE_BY_KIND",
    "LEVEL_NAMES",
    "SettingTap",
    "catalogue",
    "values",
    "scope",
    "bonds",
    "bond_indices",
    "BOND_SETTINGS",
    "drain",
    "status",
    "install",
    "uninstall",
    "parse_setting_info",
    "load_help",
    "coerce",
    "ASSET_NAME",
    "ASSET_VERSION",
    "asset_path",
    "asset_json",
    "build_asset",
    "load_asset",
    "write_asset",
]

# ---------------------------------------------------------------------------
# Type and level vocabulary
# ---------------------------------------------------------------------------

#: ``packages/engine/layer1/Setting.h:113-120`` / ``packages/engine/modules/pymol/setting.py:19-26``.
KIND_BY_TYPE: Dict[int, str] = {
    0: "blank",
    1: "boolean",
    2: "int",
    3: "float",
    4: "float3",
    5: "color",
    6: "string",
}
TYPE_BY_KIND: Dict[str, int] = {v: k for k, v in KIND_BY_TYPE.items()}

#: ``packages/engine/layer1/Setting.cpp:64-74``.  The C enum suffix used in ``SettingInfo.h``
#: (``cSettingLevel_ostate``) is not the name ``SettingLevelGetName`` returns.
LEVEL_NAMES: Dict[str, str] = {
    "unused": "unused",
    "global": "global",
    "object": "object",
    "ostate": "object-state",
    "atom": "atom",
    "astate": "atom-state",
    "bond": "bond",
    "bstate": "bond-state",
}

#: Which scopes a level may be written at (``packages/engine/layer1/Setting.cpp:55-96``).  The
#: hierarchy is a lattice, not a chain: object-state < atom < atom-state and
#: object-state < bond < bond-state are siblings.
SCOPES_BY_LEVEL: Dict[str, Tuple[str, ...]] = {
    "unused": (),
    "global": ("global",),
    "object": ("global", "object"),
    "object-state": ("global", "object", "object-state"),
    "atom": ("global", "object", "object-state", "atom"),
    "atom-state": ("global", "object", "object-state", "atom", "atom-state"),
    "bond": ("global", "object", "object-state", "bond"),
    "bond-state": ("global", "object", "object-state", "bond", "bond-state"),
}

#: ``packages/engine/layer1/SettingInfo.h:913``.
C_SETTING_INIT = 798


# ---------------------------------------------------------------------------
# The update tap
# ---------------------------------------------------------------------------


class SettingTap:
    """A cumulative, cursor-addressed log of what the status thread drained.

    Not a second consumer: :meth:`record` is called with the value
    ``cmd.get_setting_updates()`` already returned to the bridge's own poller.
    """

    #: A drain this large is a session load / reinitialize, not an edit — the
    #: first drain after boot returns every changed index (measured: 780).
    FULL_RESYNC_AT = 600

    def __init__(self, max_batches: int = 1024) -> None:
        self._lock = threading.Lock()
        self._batches: Deque[Tuple[int, Tuple[int, ...]]] = deque(maxlen=max_batches)
        self._seq = 0
        self.calls = 0
        self.recorded = 0

    def record(self, indices: Sequence[Any]) -> None:
        """Append a batch of changed setting indices to the ring, under lock.

        Non-numeric entries are dropped; an empty batch still counts as a call
        but adds no sequence entry, so :meth:`since` only advances on real change.
        """
        clean: Tuple[int, ...] = tuple(
            int(i) for i in indices if isinstance(i, (int, float))
        )
        with self._lock:
            self.calls += 1
            if not clean:
                return
            self._seq += 1
            self.recorded += len(clean)
            self._batches.append((self._seq, clean))

    def since(self, cursor: int) -> Dict[str, Any]:
        """Every index recorded after ``cursor``, plus the new cursor.

        ``lost`` is true when the ring wrapped past the caller's cursor, i.e.
        batches were evicted before it read them.  The client answers a lost
        window the same way it answers ``full``: re-read every value.
        """
        with self._lock:
            batches = list(self._batches)
            seq = self._seq
        oldest = batches[0][0] if batches else seq
        lost = bool(batches) and cursor > 0 and cursor < oldest - 1
        indices: List[int] = []
        seen = set()
        full = False
        count = 0
        for batch_seq, batch in batches:
            if batch_seq <= cursor:
                continue
            count += 1
            if len(batch) >= self.FULL_RESYNC_AT:
                full = True
            for index in batch:
                if index not in seen:
                    seen.add(index)
                    indices.append(index)
        if cursor == 0 and batches:
            # A client that has never read gets "everything so far", and that
            # is by definition a full resync of its own cache.
            full = True
        return {
            "cursor": seq,
            "indices": indices,
            "batches": count,
            "full": full,
            "lost": lost,
        }


#: Process-wide, because the thing it observes is process-wide.
TAP = SettingTap()

_installed_on: Any = None
_original_get_setting_updates: Any = None


# ---------------------------------------------------------------------------
# PyMOL handles
# ---------------------------------------------------------------------------


def _cmd_module(cmd: Any = None) -> Any:
    if cmd is not None:
        return cmd
    import pymol  # noqa: WPS433 - deliberately late; this module imports clean

    return pymol.cmd


def _setting_module() -> Any:
    import pymol.setting  # noqa: WPS433

    return pymol.setting


# ---------------------------------------------------------------------------
# SettingInfo.h — defaults, min/max (no C accessor exists; see the docstring)
# ---------------------------------------------------------------------------

_REC = re.compile(
    r"^\s*REC_(?P<macro>[_bif3sc])\(\s*(?P<index>\d+)\s*,"
    r"(?P<rest>.*?)\)\s*,?\s*$"
)

_MACRO_KIND = {
    "_": "blank",
    "b": "boolean",
    "i": "int",
    "f": "float",
    "3": "float3",
    "s": "string",
    "c": "color",
}


def _split_args(rest: str) -> List[str]:
    """Split a record's argument tail on commas outside string literals."""
    out: List[str] = []
    buf: List[str] = []
    in_string = False
    escape = False
    for char in rest:
        if escape:
            buf.append(char)
            escape = False
            continue
        if char == "\\":
            buf.append(char)
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            buf.append(char)
            continue
        if char == "," and not in_string:
            out.append("".join(buf).strip())
            buf = []
            continue
        buf.append(char)
    out.append("".join(buf).strip())
    return [token for token in out if token != ""]


_COMMENT = re.compile(r"/\*.*?\*/|//.*$")
_DEFINE = re.compile(r"^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(-?\d+)\b")


def _number(token: str, constants: Optional[Dict[str, float]] = None) -> Optional[float]:
    text = token.strip()
    if constants and text in constants:
        return constants[text]
    text = text.rstrip("fF")
    try:
        return float(text)
    except ValueError:
        return None


def _string_literal(token: str) -> str:
    token = token.strip()
    if len(token) >= 2 and token[0] == '"' and token[-1] == '"':
        return token[1:-1]
    return token


def parse_setting_info(path: str) -> Dict[int, Dict[str, Any]]:
    """``packages/engine/layer1/SettingInfo.h`` -> ``{index: {name, kind, level, default, ...}}``.

    Pure text parsing of the record macros documented at
    ``packages/engine/layer1/SettingInfo.h:15-23``; it never imports PyMOL and never guesses —
    a line it cannot parse is skipped, and the caller validates the whole result
    against the live setting table before trusting any of it.
    """
    records: Dict[int, Dict[str, Any]] = {}
    #: `#define MAX_SPHERE_QUALITY 4` (`packages/engine/layer1/SettingInfo.h:79`) is used as a
    #: max in two records; the header defines its own constants, so read them
    #: from the header rather than hard-coding a number that can drift.
    constants: Dict[str, float] = {}
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for raw_line in handle:
            define = _DEFINE.match(raw_line)
            if define is not None:
                constants[define.group(1)] = float(define.group(2))
            if "REC_" not in raw_line or raw_line.lstrip().startswith("#"):
                continue
            # Trailing `/* ... */` comments are common and are not arguments.
            line = _COMMENT.sub("", raw_line).rstrip()
            match = _REC.match(line)
            if match is None:
                continue
            macro = match.group("macro")
            index = int(match.group("index"))
            args = _split_args(match.group("rest"))
            kind = _MACRO_KIND[macro]
            name = args[0] if args else ""
            level = args[1] if len(args) > 1 else "unused"
            payload = args[2:]
            record: Dict[str, Any] = {
                "index": index,
                "name": name,
                "kind": kind,
                "level": LEVEL_NAMES.get(level, level),
                "default": None,
                "min": None,
                "max": None,
            }
            if macro == "b":
                value = _number(payload[0], constants) if payload else 0.0
                record["default"] = int(bool(value))
                record["min"] = 0
                record["max"] = 1
            elif macro in ("i", "f"):
                numbers = [_number(token, constants) for token in payload]
                if numbers and numbers[0] is not None:
                    first = numbers[0]
                    record["default"] = int(first) if macro == "i" else first
                if (
                    len(numbers) >= 3
                    and numbers[1] is not None
                    and numbers[2] is not None
                ):
                    record["min"] = int(numbers[1]) if macro == "i" else numbers[1]
                    record["max"] = int(numbers[2]) if macro == "i" else numbers[2]
            elif macro == "3":
                numbers = [_number(token, constants) for token in payload]
                if len(numbers) >= 3 and all(n is not None for n in numbers[:3]):
                    record["default"] = [float(n) for n in numbers[:3]]  # type: ignore[arg-type]
            elif macro in ("s", "c"):
                record["default"] = _string_literal(payload[0]) if payload else ""
            records[index] = record
    return records


def _repo_root() -> str:
    """The GIT root, which is where ``packages/engine/layer1/`` and ``packages/engine/data/`` live.

    ``panels/settings.py`` -> ``panels`` -> ``tenmol_bridge`` -> ``bridge`` ->
    ``web`` -> ``<repo>``.  Five, not four: this project's code moved under
    ``web/`` and the two files looked up through here — ``packages/engine/layer1/SettingInfo.h``
    and ``packages/engine/data/setting_help.csv`` — are UPSTREAM, so they are relative to the
    git root and not to ``web/``.

    Only ever used to find source-tree files; an installed wheel has neither and
    falls back to the checked-in ``setting_catalog.json`` beside this module.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        here = os.path.dirname(here)
    return here


def _candidate_paths(env: str, *relative: str) -> List[str]:
    paths: List[str] = []
    override = os.environ.get(env)
    if override:
        paths.append(override)
    root = _repo_root()
    paths.extend(os.path.join(root, *parts.split("/")) for parts in relative)
    return paths


def setting_info_path() -> Optional[str]:
    """Locate ``SettingInfo.h`` across env override and repo candidates, or ``None``.

    The header is not shipped in an installed layout, so this can legitimately
    fail to find it.
    """
    for path in _candidate_paths("TENMOL_SETTINGINFO_H", "packages/engine/layer1/SettingInfo.h"):
        if os.path.isfile(path):
            return path
    return None


def setting_help_path() -> Optional[str]:
    """Locate ``setting_help.csv`` (the tooltip source), or ``None`` if absent.

    Checks the env override and repo candidates first, then ``$PYMOL_DATA`` —
    unlike the header, the CSV is copied into installed layouts, so an installed
    bridge still finds its tooltips.
    """
    for path in _candidate_paths("TENMOL_SETTING_HELP_CSV", "packages/engine/data/setting_help.csv"):
        if os.path.isfile(path):
            return path
    #: Unlike the header, the CSV IS installed: ``setup.py`` copies ``packages/engine/data/``
    #: into the package, so ``$PYMOL_DATA/setting_help.csv`` exists in every
    #: ``pip install`` layout (verified in this venv).  Look there before
    #: giving up, so an installed bridge keeps its tooltips.
    data = os.environ.get("PYMOL_DATA")
    if data:
        path = os.path.join(data, "setting_help.csv")
        if os.path.isfile(path):
            return path
    return None


def load_help(path: Optional[str] = None) -> Dict[str, str]:
    """``packages/engine/data/setting_help.csv`` -> ``{name: description}``.

    ``"name","description","type","default","flag"``, 875 rows, and grep over
    the whole PyMOL tree finds no other consumer.  The ``default`` column is
    deliberately NOT used: it is prose ("on"/"off"/"0.14") maintained by hand and
    the authoritative default is the C table.
    """
    path = path or setting_help_path()
    if not path or not os.path.isfile(path):
        return {}
    out: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8", errors="replace", newline="") as handle:
        for row in csv.reader(handle):
            if len(row) >= 2 and row[0]:
                out[row[0].strip()] = row[1].strip()
    return out


# ---------------------------------------------------------------------------
# The build-time asset  (inventory row 203, "Setting defaults / min-max / help")
# ---------------------------------------------------------------------------
#
# WHY THIS EXISTS, and why it is a JSON asset rather than a C accessor.
#
# The two files above are SOURCE-TREE files.  ``packages/engine/layer1/SettingInfo.h`` is a
# header: no wheel, no conda package and no ``pip install pymol`` layout ships
# it, and ``setting_info_path()`` only ever looks next to this repository.  So a
# bridge running against an INSTALLED PyMOL has no defaults and no ranges at
# all -- measured on this machine by pointing ``TENMOL_SETTINGINFO_H`` at a
# nonexistent path: ``defaultsSource: None`` and 0 of 779 rows carrying a
# ``default``.  (``setting_help.csv`` is luckier: it IS installed, under
# ``$PYMOL_DATA``, and :func:`setting_help_path` now looks there too.)
#
# The row offered two deliveries.  A C accessor next to ``CmdGetSettingLevel``
# would need ``packages/engine/layer4/Cmd.cpp`` and a rebuild of the extension module -- a C++
# change, which this work is not allowed to make and which would also make the
# data unavailable to anything that is not this exact build.  The build-time
# asset needs neither: it is generated from the two source files by
#
#     python -m tenmol_bridge.panels.settings --emit
#
# checked in next to this module, and shipped with the bridge package.  It is
# validated against the live setting table index-by-index exactly as the header
# parse is, so a stale asset produces NO defaults rather than wrong ones, and
# ``test_p10_rest.py`` regenerates it in memory and fails if the checked-in copy
# differs by one byte -- staleness is a red test, not a silent lie.
#
# "SHIPPED WITH THE PACKAGE" IS A PACKAGING DECLARATION, NOT A WISH.  Being
# checked in next to the module is NOT enough: setuptools puts ``*.py`` and
# nothing else in a distribution, and for one wave this comment was simply
# false -- a built wheel held 43 ``.py`` files and ZERO ``.json``, so every
# ``pip install`` layout had the fallback (a header that is not installed
# either) and therefore no defaults at all.  What makes the sentence true is
# ``[tool.setuptools.package-data]`` in ``packages/bridge/pyproject.toml``, and what
# keeps it true is ``packages/bridge/tests/test_p11_infra2.py``, which BUILDS the wheel
# and the sdist and reads the asset back out of them -- an in-tree test cannot
# see this failure mode, because in the tree the file is always next to
# ``__file__``.

#: Next to this module, so it travels with the package.
ASSET_NAME = "setting_catalog.json"
#: Bumped when the asset's SHAPE changes; a mismatch rejects the asset.
ASSET_VERSION = 1


def asset_path() -> Optional[str]:
    """The checked-in build-time asset, or None."""
    override = os.environ.get("TENMOL_SETTING_CATALOG_JSON")
    if override:
        return override if os.path.isfile(override) else None
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ASSET_NAME)
    return path if os.path.isfile(path) else None


def build_asset(
    header_path: Optional[str] = None, help_path: Optional[str] = None
) -> Dict[str, Any]:
    """``SettingInfo.h`` + ``setting_help.csv`` -> the static JSON document.

    Pure: it reads the two files and returns a dict.  Raises ``OSError`` if
    either is missing, because emitting a half asset would be worse than not
    emitting one.
    """
    header_path = header_path or setting_info_path()
    help_path = help_path or setting_help_path()
    if not header_path:
        raise OSError("packages/engine/layer1/SettingInfo.h not found; cannot build the asset")
    if not help_path:
        raise OSError("packages/engine/data/setting_help.csv not found; cannot build the asset")
    records = parse_setting_info(header_path)
    help_text = load_help(help_path)
    return {
        "version": ASSET_VERSION,
        "cSettingInit": C_SETTING_INIT,
        # The ORIGIN, repo-relative, is what ``defaultsSource`` reports: the
        # numbers come from the header whichever way they were delivered.
        "settingInfoOrigin": "packages/engine/layer1/SettingInfo.h",
        "helpOrigin": "packages/engine/data/setting_help.csv",
        "records": [records[index] for index in sorted(records)],
        "help": help_text,
    }


def asset_json(document: Optional[Dict[str, Any]] = None) -> str:
    """The asset's on-disk text.  One writer, so a diff is a real diff."""
    return json.dumps(document or build_asset(), indent=1, sort_keys=True) + "\n"


def write_asset(path: Optional[str] = None) -> str:
    """Generate the asset and write it.  Returns the path written."""
    target = path or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), ASSET_NAME
    )
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(asset_json())
    return target


def load_asset(path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Read the asset, or None when it is absent or unusable.

    Shape errors are treated exactly like absence: this module never ships
    half-trusted data, and the caller validates whatever comes back anyway.
    """
    path = path or asset_path()
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(document, dict):
        return None
    if document.get("version") != ASSET_VERSION:
        return None
    if not isinstance(document.get("records"), list):
        return None
    return document


def _asset_records(document: Dict[str, Any]) -> Dict[int, Dict[str, Any]]:
    out: Dict[int, Dict[str, Any]] = {}
    for record in document.get("records", []):
        if isinstance(record, dict) and isinstance(record.get("index"), int):
            out[int(record["index"])] = record
    return out


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------

_catalogue_cache: Optional[Dict[str, Any]] = None


def catalogue(cmd: Any = None, refresh: bool = False) -> Dict[str, Any]:
    """Every setting Python can see, with level, default and help.

    The setting table is static (indices are frozen forever because sessions
    serialize them, ``packages/engine/layer1/SettingInfo.h:5-6``), so this is built once and
    cached for the life of the process.
    """
    global _catalogue_cache
    if _catalogue_cache is not None and not refresh:
        return _catalogue_cache

    cmd = _cmd_module(cmd)
    setting = _setting_module()
    index_dict: Dict[str, int] = dict(setting.index_dict)
    name_list: List[str] = list(setting.get_name_list())
    visible = {index_dict[name]: name for name in name_list}

    levels: Dict[int, str] = {}
    for index in visible:
        try:
            levels[index] = str(cmd._cmd.get_setting_level(index))
        except Exception:  # noqa: BLE001 - a missing level must not lose the row
            levels[index] = ""

    kinds: Dict[int, str] = {}
    for index in visible:
        try:
            kinds[index] = KIND_BY_TYPE.get(
                int(cmd._cmd.get_setting_type(index)), "blank"
            )
        except Exception:  # noqa: BLE001
            kinds[index] = "blank"

    parsed, parse_note, parse_path = _validated_setting_info(visible, levels, kinds)
    help_path = setting_help_path()
    help_text = load_help(help_path)
    if not help_text:
        # Same delivery argument as the defaults: the asset carries the CSV's
        # 875 rows, so tooltips survive a layout with no `packages/engine/data/` beside the
        # bridge.  `helpSource` reports the ORIGIN, not the asset, because that
        # is where the text was written.
        document = load_asset()
        if document is not None and isinstance(document.get("help"), dict):
            # NOT filtered on the value: `load_help` keeps a named row with an
            # empty description, so filtering here would make `helpRows`
            # disagree with the CSV by one and turn a byte-identical asset into
            # a different answer.
            help_text = {str(k): str(v) for k, v in document["help"].items() if k}
            if help_text:
                help_path = str(document.get("helpOrigin") or "packages/engine/data/setting_help.csv")

    rows: List[Dict[str, Any]] = []
    counts: Dict[str, int] = {}
    level_counts: Dict[str, int] = {}
    for index in sorted(visible):
        name = visible[index]
        kind = kinds[index]
        level = levels[index]
        row: Dict[str, Any] = {
            "index": index,
            "name": name,
            "kind": kind,
            "level": level,
            "scopes": list(SCOPES_BY_LEVEL.get(level, ("global",))),
        }
        record = parsed.get(index)
        if record is not None:
            row["default"] = record["default"]
            if record["min"] is not None:
                row["min"] = record["min"]
            if record["max"] is not None:
                row["max"] = record["max"]
        description = help_text.get(name)
        if description:
            row["help"] = description
        rows.append(row)
        counts[kind] = counts.get(kind, 0) + 1
        level_counts[level] = level_counts.get(level, 0) + 1

    # `setting.py:48` injects ray_shadows -> ray_shadow AFTER name_list is
    # snapshotted, so index_dict has exactly one more entry than name_list.
    aliases = {name: index_dict[name] for name in sorted(set(index_dict) - set(name_list))}

    _catalogue_cache = {
        "version": 1,
        "count": len(rows),
        "settings": rows,
        "aliases": aliases,
        "counts": counts,
        "levelCounts": level_counts,
        "meta": {
            "cSettingInit": C_SETTING_INIT,
            "indexDictSize": len(index_dict),
            "nameListSize": len(name_list),
            "defaultsSource": parse_path,
            "defaultsNote": parse_note,
            "minMaxEnforced": False,
            "minMaxNote": (
                "PyMOL clamps only int settings and only for global writes "
                "(packages/engine/layer1/Setting.cpp:1890-1911); ranges here are hints, not "
                "limits, and the client never clamps."
            ),
            "helpSource": help_path,
            "helpRows": len(help_text),
        },
    }
    return _catalogue_cache


def _validated_setting_info(
    visible: Dict[int, str], levels: Dict[int, str], kinds: Dict[int, str]
) -> Tuple[Dict[int, Dict[str, Any]], str, Optional[str]]:
    """Defaults and ranges, from the asset if there is one, else the header.

    Either way the records are refused unless every index agrees with the LIVE
    table: the delivery changes, the "never show wrong defaults" rule does not.
    """
    document = load_asset()
    if document is not None:
        records = _asset_records(document)
        origin = str(document.get("settingInfoOrigin") or "packages/engine/layer1/SettingInfo.h")
        parsed, note, path = _validate_records(
            records,
            visible,
            levels,
            kinds,
            label="the build-time asset panels/%s" % ASSET_NAME,
            origin=origin,
            note=(
                "defaults and ranges from the build-time asset "
                "tenmol_bridge/panels/%s, generated from %s and validated "
                "index-by-index against the live table" % (ASSET_NAME, origin)
            ),
        )
        if parsed:
            return (parsed, note, path)
        # A rejected asset falls through to the header rather than blanking the
        # column: on a source checkout the header is the more authoritative of
        # the two, and it is what the asset is generated from.
        if setting_info_path() is None:
            return ({}, note, None)

    return _validated_from_header(visible, levels, kinds)


def _validated_from_header(
    visible: Dict[int, str], levels: Dict[int, str], kinds: Dict[int, str]
) -> Tuple[Dict[int, Dict[str, Any]], str, Optional[str]]:
    """Parse the header, then refuse it unless it matches the LIVE table."""
    path = setting_info_path()
    if path is None:
        return (
            {},
            "packages/engine/layer1/SettingInfo.h not found next to the bridge; defaults and "
            "ranges are unavailable (there is no C accessor for them).",
            None,
        )
    try:
        parsed = parse_setting_info(path)
    except OSError as exc:
        return ({}, "could not read %s: %s" % (path, exc), None)

    return _validate_records(
        parsed,
        visible,
        levels,
        kinds,
        label=path,
        origin=os.path.relpath(path, _repo_root()),
        note=(
            "defaults and ranges parsed from the header that generates "
            "SettingInfo[] and validated index-by-index against the live table"
        ),
    )


def _validate_records(
    parsed: Dict[int, Dict[str, Any]],
    visible: Dict[int, str],
    levels: Dict[int, str],
    kinds: Dict[int, str],
    label: str,
    origin: str,
    note: str,
) -> Tuple[Dict[int, Dict[str, Any]], str, Optional[str]]:
    """Index-by-index agreement with the live table, or nothing at all."""
    path = label
    if len(parsed) != C_SETTING_INIT:
        return (
            {},
            "%s parsed %d records, expected cSetting_INIT=%d — rejected"
            % (path, len(parsed), C_SETTING_INIT),
            None,
        )
    for index, name in visible.items():
        record = parsed.get(index)
        if record is None or record["name"] != name:
            return (
                {},
                "%s disagrees with the live setting table at index %d (%r vs %r)"
                " — rejected wholesale rather than shown as truth"
                % (path, index, record["name"] if record else None, name),
                None,
            )
        live_level = levels.get(index, "")
        if live_level and record["level"] != live_level:
            return (
                {},
                "%s level mismatch at %d (%s vs %s) — rejected"
                % (path, index, record["level"], live_level),
                None,
            )
        live_kind = kinds.get(index, "")
        if live_kind and record["kind"] != live_kind:
            return (
                {},
                "%s type mismatch at %d (%s vs %s) — rejected"
                % (path, index, record["kind"], live_kind),
                None,
            )
    return (parsed, note, origin)


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------


def values(
    indices: Optional[Sequence[Any]] = None,
    object: str = "",  # noqa: A002 - the wire name is `object`, like cmd.get
    state: int = 0,
    cmd: Any = None,
    text: bool = True,
) -> Dict[str, Any]:
    """Read many settings at once.

    ``[[index, value, text], ...]``.  ``value`` is the typed value from
    ``cmd.get_setting_tuple`` (``packages/engine/layer1/Setting.cpp:1448-1479``: boolean/int/
    color -> int, float -> float, float3 -> 3 floats, string -> str) and
    ``text`` is ``cmd.get``'s rendering (``SettingGetTextPtr``,
    ``packages/engine/layer1/Setting.cpp:1183-1237``) — ``on``/``off``, ``%d``, ``%1.5f``,
    ``[ %1.5f, %1.5f, %1.5f ]`` and the colour's NAME.

    ``object``/``state`` follow ``ExecutiveGetSettingOfType``
    (``packages/engine/layer3/Executive.cpp:7995-8021``): object -> object CSetting, state >= 0
    -> object-state CSetting, falling back to global.

    **State is PyMOL's 1-based state**, exactly as ``cmd.get`` and
    ``cmd.get_setting_tuple`` take it (both do ``int(state) - 1`` before
    calling C, ``setting.py:381,398``): ``0`` means "not state-specific" and
    ``1`` is the first state.  Every state argument in this module is that
    convention, so nothing has to translate.
    """
    cmd = _cmd_module(cmd)
    setting = _setting_module()
    if indices is None:
        wanted = sorted(set(setting.index_dict.values()))
    else:
        wanted = []
        for item in indices:
            resolved = _resolve_index(setting, item)
            if resolved is not None:
                wanted.append(resolved)

    obj = str(object or "")
    tuple_state = int(state)
    rows: List[List[Any]] = []
    failed: List[int] = []
    for index in wanted:
        try:
            got = cmd.get_setting_tuple(index, obj, tuple_state)
        except Exception:  # noqa: BLE001 - one bad index must not lose the rest
            failed.append(index)
            continue
        if not got:
            failed.append(index)
            continue
        value = got[1]
        if isinstance(value, (tuple, list)):
            value = [_scalar(v) for v in value]
            if len(value) == 1:
                value = value[0]
        else:
            value = _scalar(value)
        if text:
            try:
                rendered = cmd.get(index, obj, tuple_state)
            except Exception:  # noqa: BLE001
                rendered = ""
            rows.append([index, value, "" if rendered is None else str(rendered)])
        else:
            rows.append([index, value])
    return {
        "object": obj,
        "state": int(state),
        "values": rows,
        "failed": failed,
    }


def _scalar(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float, str)):
        return value
    return str(value)


def _resolve_index(setting: Any, item: Any) -> Optional[int]:
    if isinstance(item, bool):
        return None
    if isinstance(item, (int, float)):
        return int(item)
    try:
        return int(setting._get_index(str(item)))
    except Exception:  # noqa: BLE001 - an unknown name is not fatal
        return None


# ---------------------------------------------------------------------------
# Scope: which overrides actually exist
# ---------------------------------------------------------------------------


def scope(
    object: str = "",  # noqa: A002
    selection: str = "",
    state: int = 0,
    cmd: Any = None,
    max_atoms: int = 5000,
) -> Dict[str, Any]:
    """Where a value actually comes from — object, object-state and atom.

    ``cmd.get_object_settings(object, state)`` (``querying.py:121-129``) returns
    the object's own CSetting as ``[[index, type, value], ...]`` — i.e. the
    settings that are genuinely OVERRIDDEN there, which a cascading read cannot
    tell you.  ``state=0`` reads the object-level CSetting, ``state>=1`` the
    object-state one.

    Atom-level overrides come from the ``s`` SettingWrapper inside ``iterate``
    (``packages/engine/layer1/P.cpp:455-606``): ``iter(s)`` yields the indices actually defined
    on that atom (``SettingUniqueGetIndicesAsPyList``).
    """
    cmd = _cmd_module(cmd)
    out: Dict[str, Any] = {
        "object": str(object or ""),
        "state": int(state),
        "objectSettings": [],
        "atoms": [],
        "truncated": False,
    }
    if object:
        try:
            got = cmd.get_object_settings(str(object), int(state))
        except Exception as exc:  # noqa: BLE001
            out["error"] = str(exc)
            got = None
        if got:
            out["objectSettings"] = [
                [int(row[0]), KIND_BY_TYPE.get(int(row[1]), "blank"), _scalar(row[2])]
                for row in got
            ]
    if selection:
        collected: List[Any] = []
        space = {"collected": collected}
        try:
            cmd.iterate(
                str(selection),
                "collected.append((model, index, list(s)))",
                space=space,
                quiet=1,
            )
        except Exception as exc:  # noqa: BLE001
            out["error"] = str(exc)
            collected = []
        atoms = [entry for entry in collected if entry[2]]
        if len(atoms) > max_atoms:
            out["truncated"] = True
            atoms = atoms[:max_atoms]
        out["atoms"] = [
            {"model": str(model), "index": int(index), "settings": [int(i) for i in ids]}
            for model, index, ids in atoms
        ]
        out["bonds"] = bonds(selection, cmd=cmd, max_bonds=max_atoms)["bonds"]
    return out


# ---------------------------------------------------------------------------
# Bond level: the six settings `cmd.set` cannot reach
# ---------------------------------------------------------------------------

#: ``packages/engine/layer1/SettingInfo.h`` level ``cSettingLevel_bond``, and the same six names
#: ``setting.py:449-490`` documents for ``get_bond``/``set_bond``.  ``cmd.set``
#: over a selection "will appear to take, but no change will be observed"
#: (``setting.py:245-248``) — a silent no-op the UI must route around.
BOND_SETTINGS: Tuple[str, ...] = (
    "valence",
    "line_width",
    "line_color",
    "stick_radius",
    "stick_color",
    "stick_transparency",
)


def bond_indices(cmd: Any = None) -> List[int]:
    """The six bond-level indices, resolved through the live name table."""
    cmd = _cmd_module(cmd)
    setting = _setting_module()
    out: List[int] = []
    for name in BOND_SETTINGS:
        index = _resolve_index(setting, name)
        if index is not None:
            out.append(index)
    return out


def bonds(
    selection: str = "",
    selection2: str = "",
    state: int = 0,
    cmd: Any = None,
    indices: Optional[Sequence[Any]] = None,
    max_bonds: int = 5000,
) -> Dict[str, Any]:
    """Per-bond overrides for a selection, via ``cmd.get_bond``.

    ``cmd.get_bond(name, sel1, sel2, state)`` (``setting.py:449-505``) returns
    ``[[model, [[idx1, idx2, value], ...]], ...]`` where ``value is None`` means
    "this bond carries no override" — the rows worth showing are the others.
    """
    cmd = _cmd_module(cmd)
    setting = _setting_module()
    wanted = (
        bond_indices(cmd)
        if indices is None
        else [i for i in (_resolve_index(setting, x) for x in indices) if i is not None]
    )
    rows: List[Dict[str, Any]] = []
    truncated = False
    error: Optional[str] = None
    if selection:
        for index in wanted:
            try:
                got = cmd.get_bond(index, str(selection), str(selection2) or None, int(state))
            except Exception as exc:  # noqa: BLE001 - one bad index is not fatal
                error = str(exc)
                continue
            for model, pairs in got or ():
                for pair in pairs or ():
                    if len(pair) < 3 or pair[2] is None:
                        continue
                    if len(rows) >= max_bonds:
                        truncated = True
                        break
                    rows.append(
                        {
                            "index": index,
                            "model": str(model),
                            "atoms": [int(pair[0]), int(pair[1])],
                            "value": _scalar(pair[2]),
                        }
                    )
    out: Dict[str, Any] = {
        "selection": str(selection or ""),
        "state": int(state),
        "settings": wanted,
        "bonds": rows,
        "truncated": truncated,
    }
    if error:
        out["error"] = error
    return out


# ---------------------------------------------------------------------------
# Coercion (mirrors setting._validate_value for the bridge's own tests)
# ---------------------------------------------------------------------------


def coerce(kind: str, raw: Any, cmd: Any = None) -> Any:
    """``packages/engine/modules/pymol/setting.py:83-112`` by way of the real implementation.

    The client mirrors these rules in TypeScript so an editor never sends a
    value PyMOL will reject; this wrapper exists so the two can be compared in a
    test instead of by eye.
    """
    setting = _setting_module()
    type_code = TYPE_BY_KIND.get(kind)
    if type_code is None:
        raise ValueError("unknown setting kind %r" % (kind,))
    return setting._validate_value(type_code, raw)


# ---------------------------------------------------------------------------
# The tap
# ---------------------------------------------------------------------------


def drain(cursor: int = 0, tap: Optional[SettingTap] = None) -> Dict[str, Any]:
    """Indices recorded since ``cursor``.  Never calls PyMOL."""
    tap = tap or TAP
    out = tap.since(int(cursor or 0))
    out["observing"] = _installed_on is not None
    return out


def status(cmd: Any = None) -> Dict[str, Any]:
    """Enough for the client to decide whether it must bootstrap."""
    return {
        "installed": _installed_on is not None,
        "cursor": TAP._seq,  # noqa: SLF001 - same module
        "calls": TAP.calls,
        "recorded": TAP.recorded,
        "catalogueBuilt": _catalogue_cache is not None,
        "module": __name__,
    }


def install(cmd: Any = None) -> Dict[str, Any]:
    """Publish the API on ``pymol.setting`` and tap the update drain.

    Idempotent.  Runs wherever it is called from — the bootstrap arrives as
    ``cmd.do('/import ...')`` and therefore executes on the engine thread, while
    the tap itself fires on the status thread; the only shared state is
    :class:`SettingTap`, which locks.
    """
    global _installed_on, _original_get_setting_updates

    cmd = _cmd_module(cmd)
    setting = _setting_module()

    if _installed_on is None:
        original = getattr(cmd, "get_setting_updates", None)
        if callable(original) and not getattr(original, "_tenmol_tap", False):

            def observed(*args: Any, **kwargs: Any) -> Any:
                result = original(*args, **kwargs)
                # Only the GLOBAL channel: get_setting_updates(name, state)
                # targets one object's state-level CSetting instead.
                if not args and not kwargs:
                    try:
                        TAP.record(result or ())
                    except Exception:  # noqa: BLE001 - never break the poller
                        pass
                return result

            observed._tenmol_tap = True  # type: ignore[attr-defined]
            observed.__name__ = "get_setting_updates"
            observed.__doc__ = getattr(original, "__doc__", None)
            _original_get_setting_updates = original
            cmd.get_setting_updates = observed
        _installed_on = cmd

    setting.tenmol_settings_status = lambda: status()
    setting.tenmol_settings_catalogue = lambda refresh=False: catalogue(refresh=refresh)
    setting.tenmol_settings_values = lambda indices=None, object="", state=0: values(
        indices, object, state
    )
    setting.tenmol_settings_scope = lambda object="", selection="", state=0: scope(
        object, selection, state
    )
    setting.tenmol_settings_bonds = lambda selection="", selection2="", state=0: bonds(
        selection, selection2, state
    )
    setting.tenmol_settings_drain = lambda cursor=0: drain(cursor)
    return status(cmd)


def uninstall(cmd: Any = None) -> None:
    """Undo :func:`install` (used by the tests; the product never calls it)."""
    global _installed_on, _original_get_setting_updates

    target = _installed_on if cmd is None else cmd
    if target is not None and _original_get_setting_updates is not None:
        try:
            target.get_setting_updates = _original_get_setting_updates
        except Exception:  # noqa: BLE001
            pass
    _installed_on = None
    _original_get_setting_updates = None
    setting = _setting_module()
    for name in (
        "tenmol_settings_status",
        "tenmol_settings_catalogue",
        "tenmol_settings_values",
        "tenmol_settings_scope",
        "tenmol_settings_bonds",
        "tenmol_settings_drain",
    ):
        if hasattr(setting, name):
            delattr(setting, name)


# ---------------------------------------------------------------------------
# Build step
# ---------------------------------------------------------------------------


def _main(argv: Optional[Sequence[str]] = None) -> int:
    """``python -m tenmol_bridge.panels.settings --emit|--check``.

    ``--check`` is what CI (and ``test_p10_rest.py``) needs: it regenerates the
    asset in memory and reports whether the checked-in copy is byte-identical,
    without writing anything.
    """
    import sys as _sys

    args = list(_sys.argv[1:] if argv is None else argv)
    mode = args[0] if args else "--emit"
    if mode not in ("--emit", "--check"):
        print("usage: python -m tenmol_bridge.panels.settings [--emit|--check]")
        return 2
    try:
        fresh = asset_json()
    except OSError as exc:
        print("cannot build the asset: %s" % exc)
        return 2
    target = os.path.join(os.path.dirname(os.path.abspath(__file__)), ASSET_NAME)
    if mode == "--check":
        current = ""
        if os.path.isfile(target):
            with open(target, "r", encoding="utf-8") as handle:
                current = handle.read()
        if current == fresh:
            print("%s is up to date (%d bytes)" % (ASSET_NAME, len(fresh)))
            return 0
        print("%s is STALE — run `python -m tenmol_bridge.panels.settings --emit`" % ASSET_NAME)
        return 1
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(fresh)
    print("wrote %s (%d bytes)" % (target, len(fresh)))
    return 0


if __name__ == "__main__":  # pragma: no cover - the build step
    raise SystemExit(_main())
