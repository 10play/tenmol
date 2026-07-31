"""Exact per-``(object, rep, state)`` invalidation for Mode G.  Defect **D1**.

WHAT REPLACED WHAT
------------------
Wave 1 detected "the geometry changed" with a 4 Hz fingerprint of
``cmd.get_vis() + cmd.get_state() + cmd.get_frame()`` plus a content hash at
fetch time, and :func:`GeometryService.capabilities` had to answer
``exactInvalidation: False``.  Two holes, both reproduced:

* ``hide everything; show sticks`` moved the fingerprint, but the fingerprint
  carries no *identity*: every cached key was marked dirty at ``cRepInvVisib``
  and **nothing told the client to DROP the cartoon**, so the stale cartoon
  stayed on screen.  That is D1.
* ``color red, resi 1-20`` does not move ``get_vis()`` **at all** —
  ``get_vis()`` is object-level (``state/__init__.py`` says so in the frozen
  barrel) — so a recolour was invisible to the poll and the client kept the old
  colours until something else happened to invalidate.  Measured on 1UBQ, this
  file's own harness: the accessor payload hash goes
  ``9f361e0f7142 -> 29aa5abee3ed`` while ``get_vis()`` is byte-identical.

Wave 2 landed ``_cmd.web_get_versions`` (``layer4/CmdWebGeometry.cpp:2145``),
backed by four monotonic counters on ``struct CExecutive``.  It answers::

    {"counters": [panel, enable, name, rep], "serial": N, "recomputed": bool,
     "changed": bool, "walks": N,
     "objects": {"<name>": {"version": N, "type": int, "enabled": bool,
                            "n_atom": int, "n_state": int,
                            "reps": {"<repname>|<state>": {"version": N,
                                                          "active": bool}}}}}

A rep stays in the map after it is hidden, with ``active: false`` and a bumped
version — which is precisely the "drop this one" signal D1 needed.  Measured in
this tree (``bridge/.venv``, 1UBQ, no GL context):

    show cartoon             cartoon|0 {version 1, active True}
    hide everything          cartoon|0 {version 2, active False}
    show sticks; show spheres  + sticks|0 {1, True}, spheres|0 {1, True}
    300 idle polls after      changed=True 0 times, 1.0 us per poll
    color red, resi 1-20      sticks|0 1 -> 2, spheres|0 1 -> 2
    delete u                  objects {} , changed=True

THIS MODULE IS PURE
-------------------
It imports nothing from PyMOL and nothing from the bridge.  It turns that raw
dict into a flat table keyed exactly like ``geometryKey()`` in
``packages/protocol/src/geometry.ts`` (``object \\0 state \\0 rep``), and diffs
two tables into the ``GeometryInvalidation``-shaped rows the ``geometry`` topic
carries.  Everything engine-bound lives in ``render/modeg.py``.

ONE JUDGEMENT CALL, STATED PLAINLY
----------------------------------
``active`` here is *effective visibility*: ``rep.active AND object.enabled``.
The C++ reports them separately and correctly — a ``disable``d object keeps its
reps — but Mode G must not draw a disabled object, and the client cache has no
other place to learn that.  ``rep_active`` and ``enabled`` are both preserved
on the entry for diagnostics, so nothing is lost.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

__all__ = [
    "KEY_SEP",
    "LEVEL_VISIB",
    "LEVEL_ALL",
    "REASONS",
    "ROW_FORMAT",
    "RepVersion",
    "make_key",
    "parse_key",
    "build_table",
    "diff_tables",
    "table_rows",
]

#: ``GEOMETRY_KEY_SEP`` in ``packages/protocol/src/geometry.ts``.  A PyMOL
#: object name may legally contain spaces, slashes and dots; NUL is the one
#: character it cannot contain.
KEY_SEP = "\x00"

#: ``cRepInv_t`` (``layer1/Rep.h:133-184``), mirrored by ``RepInv`` in
#: ``render/modeg.py`` and ``RepInvalidationLevel`` in the TypeScript.
LEVEL_VISIB = 20
LEVEL_ALL = 100

#: Why a key appears in a diff.  Carried on the wire so a client (and a human
#: reading a log) can tell "the user hid it" from "the object went away".
REASONS = (
    "created",  # the rep exists for the first time and is drawn
    "changed",  # same key, new content hash from the C++ signature
    "shown",    # active false -> true
    "hidden",   # active true -> false (`hide`, or the object was disabled)
    "deleted",  # the key vanished from the table (delete / rename / close)
)

#: Column names for the compact row form :func:`table_rows` emits.  The table
#: is polled by every Mode-G client, so it is a list of 5-element lists rather
#: than a list of dicts: 50 objects x 5 reps is ~10 kB this way and ~40 kB as
#: objects, and the poll runs at 4 Hz per client.
ROW_FORMAT = ("object", "state", "rep", "version", "active")


def make_key(object_name: str, state: int, rep: int) -> str:
    """``geometryKey({object, state, rep})`` — identical bytes to the TS."""
    return KEY_SEP.join((str(object_name), str(int(state)), str(int(rep))))


def parse_key(key: str) -> Optional[Tuple[str, int, int]]:
    parts = key.split(KEY_SEP)
    if len(parts) != 3:
        return None
    try:
        return parts[0], int(parts[1]), int(parts[2])
    except (TypeError, ValueError):
        return None


class RepVersion:
    """One ``(object, state, rep)`` row of the table."""

    __slots__ = (
        "object",
        "state",
        "rep",
        "version",
        "active",
        "rep_active",
        "enabled",
        "object_version",
    )

    def __init__(
        self,
        object_name: str,
        state: int,
        rep: int,
        version: int,
        rep_active: bool,
        enabled: bool = True,
        object_version: int = 0,
    ) -> None:
        self.object = str(object_name)
        self.state = int(state)
        self.rep = int(rep)
        self.version = int(version)
        self.rep_active = bool(rep_active)
        self.enabled = bool(enabled)
        #: Effective visibility — see the module docstring.
        self.active = bool(rep_active and enabled)
        self.object_version = int(object_version)

    @property
    def key(self) -> str:
        return make_key(self.object, self.state, self.rep)

    def row(self) -> List[Any]:
        """The compact wire form; see :data:`ROW_FORMAT`."""
        return [self.object, self.state, self.rep, self.version, 1 if self.active else 0]

    def same(self, other: "RepVersion") -> bool:
        return self.version == other.version and self.active == other.active

    def __repr__(self) -> str:  # pragma: no cover - diagnostics
        return "RepVersion(%r, state=%d, rep=%d, v=%d, active=%s)" % (
            self.object,
            self.state,
            self.rep,
            self.version,
            self.active,
        )


def build_table(
    raw: Mapping[str, Any], rep_ids: Mapping[str, int]
) -> Dict[str, RepVersion]:
    """``_cmd.web_get_versions()`` output -> ``{key: RepVersion}``.

    ``rep_ids`` maps the C++ rep NAMES (``repIndexToName``,
    ``layer4/CmdWebGeometry.cpp:322-350``) onto ``cRep_t`` indices; it is passed
    in rather than imported so this module stays free of the render package.
    An unrecognised rep name is skipped, not guessed: a name this bridge does
    not know is a name it cannot fetch either.
    """
    table: Dict[str, RepVersion] = {}
    objects = raw.get("objects") or {}
    if not isinstance(objects, Mapping):
        return table
    for name, entry in objects.items():
        if not isinstance(entry, Mapping):
            continue
        enabled = bool(entry.get("enabled", True))
        object_version = int(entry.get("version", 0) or 0)
        reps = entry.get("reps") or {}
        if not isinstance(reps, Mapping):
            continue
        for rep_key, rep_entry in reps.items():
            parsed = _split_rep_key(str(rep_key), rep_ids)
            if parsed is None:
                continue
            rep_index, state = parsed
            if not isinstance(rep_entry, Mapping):
                continue
            version = RepVersion(
                str(name),
                state,
                rep_index,
                int(rep_entry.get("version", 0) or 0),
                bool(rep_entry.get("active", False)),
                enabled=enabled,
                object_version=object_version,
            )
            table[version.key] = version
    return table


def _split_rep_key(
    rep_key: str, rep_ids: Mapping[str, int]
) -> Optional[Tuple[int, int]]:
    """``'cartoon|0'`` -> ``(5, 0)``.  ``None`` when the name is unknown."""
    if "|" not in rep_key:
        return None
    name, _sep, state_text = rep_key.rpartition("|")
    if name not in rep_ids:
        return None
    try:
        return int(rep_ids[name]), int(state_text)
    except (TypeError, ValueError):
        return None


def diff_tables(
    old: Mapping[str, RepVersion],
    new: Mapping[str, RepVersion],
    sizes: Optional[Mapping[str, int]] = None,
) -> List[Dict[str, Any]]:
    """``GeometryInvalidation[]`` (plus ``active``/``version``/``reason``).

    The extra three fields are the whole point: ``invalidated`` alone can only
    say "pull it again", and D1 is the case where the right answer is "throw it
    away".  ``packages/protocol/src/topics/geometry.ts`` types the first five
    fields; the extras ride along as additional JSON members (see
    ``needsFromOthers`` — the interface should grow them).

    Deterministic order: object name, then state, then rep index, so a test can
    compare a whole diff and a log stays readable.
    """
    sizes = sizes or {}
    out: List[Dict[str, Any]] = []

    for key, entry in new.items():
        before = old.get(key)
        if before is None:
            if not entry.active:
                # A rep that appears already inactive has nothing to draw and
                # nothing cached to drop.  Announcing it would be a false
                # positive with a client-visible cost (a pull that answers
                # `not-built`), so it is silently absorbed into the table.
                continue
            out.append(_row(entry, "created", LEVEL_ALL, sizes))
            continue
        if before.same(entry):
            continue
        if before.active and not entry.active:
            out.append(_row(entry, "hidden", LEVEL_VISIB, sizes))
        elif not before.active and entry.active:
            out.append(_row(entry, "shown", LEVEL_ALL, sizes))
        else:
            out.append(_row(entry, "changed", LEVEL_ALL, sizes))

    for key, entry in old.items():
        if key in new:
            continue
        # delete / set_name / close: the whole object left the table.  The
        # client must drop it whether or not it was visible, because its
        # buffers are still uploaded to the GPU.
        out.append(
            _row(
                RepVersion(
                    entry.object,
                    entry.state,
                    entry.rep,
                    entry.version + 1,
                    False,
                    enabled=False,
                    object_version=entry.object_version,
                ),
                "deleted",
                LEVEL_VISIB,
                sizes,
            )
        )

    out.sort(key=lambda row: (row["object"], row["state"], row["rep"]))
    return out


def _row(
    entry: RepVersion, reason: str, level: int, sizes: Mapping[str, int]
) -> Dict[str, Any]:
    row: Dict[str, Any] = {
        "object": entry.object,
        "state": entry.state,
        "rep": entry.rep,
        "level": int(level),
        "estimatedBytes": int(sizes.get(entry.key, 0)),
        "version": entry.version,
        "active": entry.active,
        "reason": reason,
    }
    return row


def table_rows(table: Mapping[str, RepVersion]) -> List[List[Any]]:
    """The compact wire form of a whole table, in :data:`ROW_FORMAT` order."""
    return [
        entry.row()
        for entry in sorted(
            table.values(), key=lambda e: (e.object, e.state, e.rep)
        )
    ]


def tracked_keys(table: Mapping[str, RepVersion], objects: Iterable[str]) -> List[str]:
    """Keys belonging to ``objects``.  Used to prune a cache on delete."""
    wanted = set(objects)
    return [key for key, entry in table.items() if entry.object in wanted]
