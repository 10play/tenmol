"""Movie, frame/state and scene data feeds.  OWNER: WP-20.

Why this module exists
----------------------
PyMOL's movie panel and scene bin are C++ ``Block::draw`` surfaces
(``layer1/Movie.cpp:1488`` ``MovieDraw``/``MovieClick``, ``layer1/Scene.cpp:2885``
``SceneDrawButtons``).  They are redrawn every frame from live C structures and
there is **no Python getter for any of it**: ``MovieGetSpecLevel`` is not in the
``_cmd`` method table (``layer4/Cmd.cpp:6486-6627`` lists only
``get_movie_length`` / ``get_movie_locked`` / ``get_movie_playing`` / ``mset`` /
``mview`` on the movie side), and ``cmd.mdump`` *prints* the per-frame commands
instead of returning them (``modules/pymol/moving.py:81``).

There is exactly one structured readout of the movie in this tree, and it is
``MovieAsPyList`` (``layer1/Movie.cpp:499``), reached from Python through
``cmd.get_session()`` (``ExecutiveGetSession``, ``layer3/Executive.cpp:5599``).
It carries everything the timeline needs::

    session['movie'] = [ NFrame, MatrixFlag, Matrix[25], Playing,
                         Sequence,          # frame -> 0-based state
                         Cmd,               # frame -> command string
                         ViewElem ]         # frame -> CViewElem, 21 fields

and each ``CViewElem`` element is ``ViewElemAsPyList``
(``layer1/View.cpp:341``), whose indices this module hard-codes once, with the
line number, so nobody has to guess::

    12 specification_level   0 none / 1 interpolated / 2 key frame
    13 scene_flag            14 scene_name (str when flagged, else int 0)
    19 state_flag            20 state
    11 view_mode              0 matrix_flag  15 power_flag  17 bias_flag

Per-object motions live in the same shape one level down, in
``ObjectAsPyList`` slots 12/13 (``layer1/PyMOLObject.cpp:696-703``), which is
how the object rows of ``ExecutiveMotionDraw`` (``layer3/Executive.cpp:692``)
are reproduced here.

MEASURED COST (this machine, ``scratchpad/wp20/p5.py``), because a panel feed
that is polled has to justify itself:

======  ======  ==========================  ==========
object  atoms   ``get_session`` full        cheap poll
======  ======  ==========================  ==========
1UBQ       660  0.3 ms                      0.01 ms
4HHB     5,439  3.0 ms                      0.01 ms
1AON    64,309  40.8 ms                     0.01 ms
======  ======  ==========================  ==========

So :func:`movie_status` (``count_frames`` + ``get_frame`` + ``get_state`` +
``get_movie_playing`` + settings, 0.01 ms) is the **poll**, and
:func:`movie_panel` (``get_session``, up to 41 ms) is **on demand only** — the
client calls it when the timeline is open and after a movie edit, never at
30 Hz.  Filtering ``get_session(names=...)`` does NOT help: a pattern that
matches nothing yields ``list_id == 0``, which ``ExecutiveGetNamedEntries``
reads as "everything" (measured: 36.7 ms vs 40.8 ms on 1AON).

How the client reaches these functions
--------------------------------------
``install()`` binds them onto the ``pymol.cmd`` module as ordinary public
attributes, so the wire name is a plain two-segment ``cmd.get_movie_panel``
that the capability policy already allows (root ``cmd`` is in
``DEFAULT_ROOTS``; the leaf is public, so no ``policy/grants/`` entry is
needed).  Importing this module installs them, which means the whole bootstrap
from the browser is one silent call::

    cmd.do('/import tenmol_bridge.panels.movie', echo=0, log=0)

That is deliberate: ``server.py``, ``dispatch.py`` and the frozen
``panels/__init__.py`` barrel belong to other work packages, and plan §5.2 says
a feature installs itself instead of editing a shared file.
"""

from __future__ import annotations

import base64
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

__all__ = [
    "EXPORTS",
    "install",
    "uninstall",
    "movie_status",
    "movie_panel",
    "scene_panel",
    "scene_thumbnail_png",
    "movie_export_png",
    "movie_encoders",
    "SPEC_NONE",
    "SPEC_INTERPOLATED",
    "SPEC_KEY",
    "STORE_BITS",
    "THUMBNAIL_WIDTH",
    "THUMBNAIL_HEIGHT",
]

# -- CViewElem list indices (layer1/View.cpp:341-425) -----------------------
VE_MATRIX_FLAG = 0
VE_VIEW_MODE = 11
VE_SPEC_LEVEL = 12
VE_SCENE_FLAG = 13
VE_SCENE_NAME = 14
VE_POWER_FLAG = 15
VE_POWER = 16
VE_BIAS_FLAG = 17
VE_BIAS = 18
VE_STATE_FLAG = 19
VE_STATE = 20

#: ``CViewElem::specification_level`` (``layer1/View.h:24``).
SPEC_NONE = 0
SPEC_INTERPOLATED = 1
SPEC_KEY = 2

#: ``MovieAsPyList`` slots (``layer1/Movie.cpp:504-523``).
MV_NFRAME = 0
MV_MATRIX_FLAG = 1
MV_MATRIX = 2
MV_PLAYING = 3
MV_SEQUENCE = 4
MV_CMD = 5
MV_VIEWELEM = 6

#: ``ObjectAsPyList`` slots (``layer1/PyMOLObject.cpp:696-703``).
OBJ_NAME = 1
OBJ_VIEWELEM_N = 12
OBJ_VIEWELEM = 13

#: ``ExecutiveGetExecObjectAsPyList`` (``layer3/Executive.cpp:5391-5397``):
#: ``[name, cExecObject, visible, None, objtype, <object payload>, ...]``, and
#: the payload's slot 0 is ``ObjectAsPyList``.  Slot **5**, not 4 — slot 3 is a
#: pre-1.8 compatibility hole and slot 4 is the type enum.
EXEC_TYPE = 1
EXEC_PAYLOAD = 5
#: ``enum ExecRec_t { cExecObject = 0, cExecSelection = 1, cExecAll = 2 }``
#: (``layer3/Executive.h:193``).  Selections serialise with a different shape
#: (``ExecutiveGetExecSeleAsPyList``) and carry no motions.
EXEC_TYPE_OBJECT = 0

#: ``MovieScene::storemask`` bits.  The ORDER IS NOT THE ORDER OF THE ARGUMENTS
#: — ``MovieSceneStore``'s parameter list is view/color/active/rep/frame but the
#: enum (``layer3/MovieScene.h:27-34``) is VIEW, **ACTIVE**, **COLOR**, REP,
#: FRAME, THUMBNAIL.  Getting those two the wrong way round reports "color" for
#: a camera-only scene, which is exactly what the Append> submenu is for.
STORE_BITS: Tuple[Tuple[int, str], ...] = (
    (1 << 0, "view"),
    (1 << 1, "active"),
    (1 << 2, "color"),
    (1 << 3, "rep"),
    (1 << 4, "frame"),
    (1 << 5, "thumbnail"),
)

#: ``MovieScene::THUMBNAIL_WIDTH/HEIGHT`` (``layer3/MovieScene.h:100-101``).
THUMBNAIL_WIDTH = 220
THUMBNAIL_HEIGHT = 124

#: Settings the movie/scene UI binds to.  ``kind`` picks the getter so a float
#: setting is never truncated and a string setting never becomes ``0``.
_SETTINGS: Tuple[Tuple[str, str], ...] = (
    ("movie_fps", "f"),
    ("movie_delay", "f"),
    ("movie_loop", "b"),
    ("movie_auto_interpolate", "b"),
    ("movie_auto_store", "b"),
    ("movie_panel", "b"),
    ("movie_panel_row_height", "i"),
    ("movie_quality", "i"),
    ("draw_frames", "b"),
    ("ray_trace_frames", "b"),
    ("cache_frames", "b"),
    ("static_singletons", "b"),
    ("all_states", "b"),
    ("sweep_mode", "i"),
    ("sweep_angle", "f"),
    ("sweep_speed", "f"),
    ("sweep_phase", "f"),
    ("rock_delay", "f"),
    ("rock", "b"),
    ("scene_buttons", "b"),
    ("scene_loop", "b"),
    ("scene_animation", "i"),
    ("scene_animation_duration", "f"),
    ("scene_frame_mode", "i"),
    ("scene_current_name", "s"),
    ("presentation", "b"),
    ("seq_view", "b"),
    ("text", "b"),
)


def _cmd_module() -> Any:
    import pymol.cmd as pymol_cmd  # noqa: WPS433 - deliberately late

    return pymol_cmd


def _resolve(cmd: Optional[Any]) -> Any:
    return _cmd_module() if cmd is None else cmd


def _settings(cmd: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for name, kind in _SETTINGS:
        try:
            if kind == "s":
                out[name] = str(cmd.get(name))
            elif kind == "f":
                out[name] = float(cmd.get_setting_float(name))
            elif kind == "b":
                out[name] = bool(cmd.get_setting_boolean(name))
            else:
                out[name] = int(cmd.get_setting_int(name))
        except Exception:  # noqa: BLE001 - an unknown setting must not kill the panel
            out[name] = None
    return out


# --------------------------------------------------------------------------
# the cheap poll
# --------------------------------------------------------------------------


def movie_status(cmd: Optional[Any] = None) -> Dict[str, Any]:
    """Everything the transport bar needs, in ~0.01 ms.

    ``playing`` is ``MoviePlaying`` (``layer1/Movie.cpp:540``), which is false
    while the movie is *locked*, so ``locked`` is reported next to it rather
    than folded in.  The backend is the clock (plan §6 WP-20): the client
    renders this and never runs a frame timer of its own.
    """
    cmd = _resolve(cmd)
    nframes = int(cmd.count_frames())
    status: Dict[str, Any] = {
        "frame": int(cmd.get_frame()),
        "state": int(cmd.get_state()),
        "nframes": nframes,
        "length": int(cmd.get_movie_length()),
        "playing": bool(cmd.get_movie_playing()),
        "locked": bool(cmd.get_movie_locked()),
        # ControlRock(-2) is documented as "query only" (layer1/Control.cpp:415).
        "rocking": bool(cmd.rock(-2)),
        "settings": _settings(cmd),
    }
    status["fps"] = status["settings"].get("movie_fps")
    status["sceneCurrent"] = status["settings"].get("scene_current_name") or None
    return status


# --------------------------------------------------------------------------
# the on-demand timeline
# --------------------------------------------------------------------------


def _session(cmd: Any) -> Dict[str, Any]:
    """``get_session`` with the two arguments that make it side-effect free.

    ``version=0`` matters: ``exporting.py:404`` recalls **every scene in turn**
    when ``0 < pse_export_version < 1.76`` in order to write legacy scene
    entries, which from a panel refresh would look like the viewport
    flickering through the whole scene bin.  Passing 0 takes the
    ``legacyscenes`` guard down the false branch.  ``cache=0`` skips the
    ``cache optimize`` pass that ``cache=-1`` can trigger.
    """
    return cmd.get_session(partial=0, quiet=1, cache=0, version=0)


def _elem(view_elem: Optional[Sequence[Any]], index: int) -> Optional[Sequence[Any]]:
    if not view_elem or index >= len(view_elem):
        return None
    element = view_elem[index]
    return element if element else None


def _spec_levels(view_elem: Optional[Sequence[Any]], nframes: int) -> List[int]:
    levels: List[int] = []
    for i in range(nframes):
        element = _elem(view_elem, i)
        levels.append(int(element[VE_SPEC_LEVEL]) if element else SPEC_NONE)
    return levels


def _scene_at(element: Optional[Sequence[Any]]) -> Optional[str]:
    """``scene_name`` is a *string* only when ``scene_flag`` is set.

    ``layer1/View.cpp:393-401`` writes the lexicon string when flagged and the
    integer ``0`` otherwise, so a naive read of slot 14 yields ``0`` for every
    unflagged frame and the timeline grows phantom scene pins.
    """
    if not element or not int(element[VE_SCENE_FLAG]):
        return None
    name = element[VE_SCENE_NAME]
    return str(name) if isinstance(name, str) else None


def _state_at(element: Optional[Sequence[Any]]) -> Optional[int]:
    if not element or not int(element[VE_STATE_FLAG]):
        return None
    value = element[VE_STATE]
    return int(value) if value is not None else None


def _object_rows(session: Dict[str, Any], nframes: int) -> List[Dict[str, Any]]:
    """One row per object carrying motions — ``ExecutiveMotionDraw`` parity.

    ``layer3/Executive.cpp:692`` emits a row for every object whose
    ``ObjectGetSpecLevel >= 0``; here that is "the object's ``ViewElem`` is not
    None", which is the same condition one serialisation step later.
    """
    rows: List[Dict[str, Any]] = []
    for entry in session.get("names") or []:
        if not entry or len(entry) <= EXEC_PAYLOAD:
            continue
        if entry[EXEC_TYPE] != EXEC_TYPE_OBJECT:
            continue
        name = entry[0]
        payload = entry[EXEC_PAYLOAD]
        if not isinstance(payload, (list, tuple)) or not payload:
            continue
        header = payload[0]
        if not isinstance(header, (list, tuple)) or len(header) <= OBJ_VIEWELEM:
            continue
        view_elem = header[OBJ_VIEWELEM]
        if not view_elem:
            continue
        rows.append(
            {
                "object": str(name),
                "spec": _spec_levels(view_elem, nframes),
                "scenes": [_scene_at(_elem(view_elem, i)) for i in range(nframes)],
            }
        )
    return rows


def movie_panel(
    cmd: Optional[Any] = None, objects: int = 1, session: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """The movie timeline: cells, spec levels, per-frame commands and rows.

    ``rows[0]`` is always the camera row (``cExecAll`` in
    ``ExecutiveMotionDraw``); the rest are objects with motions.  ``height`` is
    ``movie_panel_row_height * len(rows)``, the same arithmetic as
    ``MovieGetPanelHeight`` (``layer1/Movie.cpp:1701``).
    """
    cmd = _resolve(cmd)
    nframes = int(cmd.count_frames())
    session = _session(cmd) if session is None else session
    movie = session.get("movie") or []

    sequence: Sequence[int] = (
        movie[MV_SEQUENCE] if len(movie) > MV_SEQUENCE and movie[MV_SEQUENCE] else []
    )
    commands: Sequence[str] = (
        movie[MV_CMD] if len(movie) > MV_CMD and movie[MV_CMD] else []
    )
    view_elem: Optional[Sequence[Any]] = (
        movie[MV_VIEWELEM] if len(movie) > MV_VIEWELEM else None
    )

    cells: List[Dict[str, Any]] = []
    for i in range(nframes):
        element = _elem(view_elem, i)
        cells.append(
            {
                "frame": i + 1,
                # Sequence is 0-based on the wire (`_cmd.mset` takes 0-based
                # states, moving.py:691); states are 1-based everywhere else.
                "state": int(sequence[i]) + 1 if i < len(sequence) else i + 1,
                "command": str(commands[i]) if i < len(commands) else "",
                "spec": int(element[VE_SPEC_LEVEL]) if element else SPEC_NONE,
                "scene": _scene_at(element),
                "stateKey": _state_at(element),
            }
        )

    rows: List[Dict[str, Any]] = [
        {
            "object": "",
            "spec": _spec_levels(view_elem, nframes),
            "scenes": [_scene_at(_elem(view_elem, i)) for i in range(nframes)],
        }
    ]
    if int(objects):
        rows.extend(_object_rows(session, nframes))

    row_height = 0
    try:
        row_height = int(cmd.get_setting_int("movie_panel_row_height"))
    except Exception:  # noqa: BLE001
        row_height = 0

    return {
        "nframes": nframes,
        "cells": cells,
        "rows": rows,
        "visible": bool(cmd.get_setting_boolean("movie_panel")),
        "rowHeight": row_height,
        "height": row_height * len(rows),
        "matrix": bool(movie[MV_MATRIX_FLAG]) if len(movie) > MV_MATRIX_FLAG else False,
    }


# --------------------------------------------------------------------------
# scenes
# --------------------------------------------------------------------------


def _storemask_names(mask: int) -> List[str]:
    return [name for bit, name in STORE_BITS if mask & bit]


def scene_panel(
    cmd: Optional[Any] = None, session: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """The scene bin: order, message and storemask per scene.

    ``cmd.get_scene_list()`` is ``_cmd.get_scene_order`` (``viewing.py:919``)
    and gives the order; the *storemask* has no getter at all, so it comes from
    ``MovieScenesAsPyList`` (``layer3/MovieScene.cpp:918``) via the same
    session readout as the timeline.  When the session is unavailable the
    storemask degrades to ``None`` rather than to a lie.
    """
    cmd = _resolve(cmd)
    order = [str(name) for name in (cmd.get_scene_list() or [])]
    current = str(cmd.get("scene_current_name") or "") or None

    masks: Dict[str, int] = {}
    if session is None:
        try:
            session = _session(cmd)
        except Exception:  # noqa: BLE001
            session = None
    entries = (session or {}).get("moviescenes") or []
    # ``PConvArgsToPyList(order, dict)`` (``layer3/MovieScene.cpp:919``) is
    # ``[order, flat]`` where `flat` is a FLATTENED map — key, value, key,
    # value — not a list of pairs.  Measured: ``['S1', [63, 0, 'msg1', ...]]``.
    # Slot 0 of each value is ``MovieScene::storemask``.
    flat = entries[1] if len(entries) > 1 and entries[1] else []
    for i in range(0, len(flat) - 1, 2):
        key, value = flat[i], flat[i + 1]
        if isinstance(key, str) and isinstance(value, (list, tuple)) and value:
            masks[key] = int(value[0])

    scenes: List[Dict[str, Any]] = []
    for name in order:
        mask = masks.get(name)
        try:
            message = str(cmd.get_scene_message(name) or "")
        except Exception:  # noqa: BLE001
            message = ""
        scenes.append(
            {
                "name": name,
                "message": message,
                "storemask": mask,
                "stores": _storemask_names(mask) if mask is not None else None,
                "current": name == current,
            }
        )
    return {"scenes": scenes, "current": current, "order": order}


def scene_thumbnail_png(cmd: Optional[Any] = None, name: str = "") -> Dict[str, Any]:
    """``cmd.get_scene_thumbnail`` as a base64 payload the browser can show.

    TWO FORMATS COME OUT OF THIS C CALL and the inventory only documents one.
    ``MovieSceneStore`` resizes ``scene.thumbnail`` to 220x124 and then hands it
    to ``SceneDeferImage`` (``layer3/MovieScene.cpp:225-232``), so a read that
    happens *before* the deferred draw lands returns the raw, zero-filled RGBA
    buffer — 220*124*4 = 109,120 bytes — and only afterwards does it return the
    encoded PNG (measured: 109,120 zero bytes immediately, 1,376 PNG bytes one
    draw later).  Reporting ``encoding`` lets the client re-request instead of
    rendering a black rectangle.
    """
    cmd = _resolve(cmd)
    raw = cmd.get_scene_thumbnail(str(name)) or b""
    data = bytes(raw)
    is_png = data[:8] == b"\x89PNG\r\n\x1a\n"
    return {
        "name": str(name),
        "encoding": "png" if is_png else ("rgba" if data else "empty"),
        "width": THUMBNAIL_WIDTH,
        "height": THUMBNAIL_HEIGHT,
        "bytes": len(data),
        "ready": is_png,
        "data": base64.b64encode(data).decode("ascii") if is_png else "",
    }


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------


def movie_export_png(
    cmd: Optional[Any] = None,
    prefix: str = "",
    first: int = 0,
    last: int = 0,
    preserve: int = 0,
    mode: int = -1,
    width: int = 0,
    height: int = 0,
    quiet: int = 1,
) -> Dict[str, Any]:
    """``cmd.mpng`` with ``modal=0``, plus the file list it never returns.

    **``modal=0`` on purpose — this is blocker A2.**  ``modal=1`` installs
    ``MovieModalDraw`` through ``PyMOL_SetModalDraw``
    (``layer1/Movie.cpp:865``), and until the pump has drawn enough times to
    finish the export **every other API call raises**
    ``APIEnterNotModal``.  Measured here: the very next ``cmd.count_atoms``
    after a modal ``mpng`` raised ``Error: APIEnterNotModal(G)``; the modal
    state cleared 0.16 s later and the engine was intact.  With ``modal=0``
    ``MoviePNG`` runs its own ``while(!M->complete)`` loop
    (``layer1/Movie.cpp:872-875``) inside one pump task, so the engine is never
    observably wedged.  ``modal=0`` only works because ``Shims`` installs
    ``_call_with_opengl_context`` with ``_pushValidContext``
    (``shims.py``) — measured: 7/7 PNGs written, 0.06 s.
    """
    cmd = _resolve(cmd)
    prefix = str(prefix)
    directory = os.path.dirname(prefix) or "."
    # `MoviePNG` opens `<prefix>%04d.png` for writing and reports a missing
    # directory only as `MoviePNG-Error` in the console, so the caller gets an
    # empty file list and no explanation. Creating it is what the Qt save
    # dialog effectively does by only ever offering existing directories.
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError:
        pass
    before = set(_listdir(directory))
    cmd.mpng(
        prefix,
        first=int(first),
        last=int(last),
        preserve=int(preserve),
        modal=0,
        mode=int(mode),
        quiet=int(quiet),
        width=int(width),
        height=int(height),
    )
    after = _listdir(directory)
    base = os.path.basename(prefix)
    files = sorted(
        name
        for name in after
        if name.startswith(base) and name.lower().endswith(".png")
    )
    return {
        "prefix": prefix,
        "dir": directory,
        "files": files,
        "written": sorted(set(files) - before),
        "count": len(files),
    }


def _listdir(directory: str) -> List[str]:
    try:
        return os.listdir(directory)
    except OSError:
        return []


def movie_encoders(cmd: Optional[Any] = None) -> Dict[str, Any]:
    """``pymol.movie.find_exe`` for the three encoders the export form offers.

    ``modules/pymol/movie.py:824`` is the same probe the Qt dialog uses to grey
    out a format (``modules/pmg_qt/file_dialogs.py:691``).
    """
    import pymol.movie as pymol_movie  # noqa: WPS433

    found: Dict[str, Any] = {}
    for exe in ("ffmpeg", "convert", "mpeg_encode"):
        try:
            found[exe] = pymol_movie.find_exe(exe)
        except Exception:  # noqa: BLE001
            found[exe] = None
    return found


# --------------------------------------------------------------------------
# installation
# --------------------------------------------------------------------------

#: wire name -> implementation.  Every name is public and two segments, so the
#: capability policy admits it with no ``policy/grants/`` entry (plan §A6:
#: root ``cmd`` is granted, private *leaves* are the only thing gated).
EXPORTS: Dict[str, Any] = {
    "get_movie_status": movie_status,
    "get_movie_panel": movie_panel,
    "get_scene_panel": scene_panel,
    "get_scene_thumbnail_png": scene_thumbnail_png,
    "movie_export_png": movie_export_png,
    "get_movie_encoders": movie_encoders,
}


def _bind(function: Any) -> Any:
    """``f(cmd=None, ...)`` -> ``f(...)`` bound to the live ``pymol.cmd``."""

    def bound(*args: Any, **kwargs: Any) -> Any:
        if "cmd" in kwargs:
            return function(**kwargs)
        return function(_cmd_module(), *args, **kwargs)

    bound.__name__ = function.__name__
    bound.__doc__ = function.__doc__
    bound.__wrapped__ = function  # type: ignore[attr-defined]
    return bound


def install(cmd: Optional[Any] = None) -> List[str]:
    """Bind :data:`EXPORTS` onto the ``cmd`` namespace.  Idempotent."""
    target = _resolve(cmd)
    installed: List[str] = []
    for name, function in EXPORTS.items():
        existing = getattr(target, name, None)
        if existing is not None and getattr(existing, "__wrapped__", None) is function:
            installed.append(name)
            continue
        setattr(target, name, _bind(function))
        installed.append(name)
    return installed


def uninstall(cmd: Optional[Any] = None) -> List[str]:
    target = _resolve(cmd)
    removed: List[str] = []
    for name, function in EXPORTS.items():
        existing = getattr(target, name, None)
        if existing is not None and getattr(existing, "__wrapped__", None) is function:
            delattr(target, name)
            removed.append(name)
    return removed


try:  # pragma: no cover - import-time convenience, exercised by test_movie.py
    install()
except Exception:  # noqa: BLE001 - importable without PyMOL (docs, linting)
    pass
