"""Movie, frame/state and scene data feeds.  OWNER: WP-20.

Why this module exists
----------------------
PyMOL's movie panel and scene bin are C++ ``Block::draw`` surfaces
(``packages/engine/layer1/Movie.cpp:1488`` ``MovieDraw``/``MovieClick``, ``packages/engine/layer1/Scene.cpp:2885``
``SceneDrawButtons``).  They are redrawn every frame from live C structures and
there is **no Python getter for any of it**: ``MovieGetSpecLevel`` is not in the
``_cmd`` method table (``packages/engine/layer4/Cmd.cpp:6486-6627`` lists only
``get_movie_length`` / ``get_movie_locked`` / ``get_movie_playing`` / ``mset`` /
``mview`` on the movie side), and ``cmd.mdump`` *prints* the per-frame commands
instead of returning them (``packages/engine/modules/pymol/moving.py:81``).

There is exactly one structured readout of the movie in this tree, and it is
``MovieAsPyList`` (``packages/engine/layer1/Movie.cpp:499``), reached from Python through
``cmd.get_session()`` (``ExecutiveGetSession``, ``packages/engine/layer3/Executive.cpp:5599``).
It carries everything the timeline needs::

    session['movie'] = [ NFrame, MatrixFlag, Matrix[25], Playing,
                         Sequence,          # frame -> 0-based state
                         Cmd,               # frame -> command string
                         ViewElem ]         # frame -> CViewElem, 21 fields

and each ``CViewElem`` element is ``ViewElemAsPyList``
(``packages/engine/layer1/View.cpp:341``), whose indices this module hard-codes once, with the
line number, so nobody has to guess::

    12 specification_level   0 none / 1 interpolated / 2 key frame
    13 scene_flag            14 scene_name (str when flagged, else int 0)
    19 state_flag            20 state
    11 view_mode              0 matrix_flag  15 power_flag  17 bias_flag

Per-object motions live in the same shape one level down, in
``ObjectAsPyList`` slots 12/13 (``packages/engine/layer1/PyMOLObject.cpp:696-703``), which is
how the object rows of ``ExecutiveMotionDraw`` (``packages/engine/layer3/Executive.cpp:692``)
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
    "movie_key_frames",
    "key_frame_payload",
    "scene_panel",
    "scene_thumbnail_png",
    "movie_export_png",
    "movie_encoders",
    "movie_produce",
    "produce_plan",
    "LABEL_CAMERA",
    "LABEL_STATES",
    "LABEL_INDENT",
    "MPEG_EXTENSIONS",
    "EVEN_EXTENSIONS",
    "FPS_LEGAL_VALUES",
    "SPEC_NONE",
    "SPEC_INTERPOLATED",
    "SPEC_KEY",
    "STORE_BITS",
    "VE_LENGTH",
    "THUMBNAIL_WIDTH",
    "THUMBNAIL_HEIGHT",
]

# -- CViewElem list indices (packages/engine/layer1/View.cpp:341-425) -----------------------
VE_MATRIX_FLAG = 0
VE_MATRIX = 1
VE_PRE_FLAG = 2
VE_PRE = 3
VE_POST_FLAG = 4
VE_POST = 5
VE_CLIP_FLAG = 6
VE_FRONT = 7
VE_BACK = 8
VE_ORTHO_FLAG = 9
VE_ORTHO = 10
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
#: ``PyList_New(21)`` (``packages/engine/layer1/View.cpp:348``).  ``timing_flag``/``timing``
#: (``packages/engine/layer1/View.h:50``) are NOT among those 21 slots and have no other
#: Python route, which is the one part of the struct no getter can expose.
VE_LENGTH = 21

#: ``CViewElem::specification_level`` (``packages/engine/layer1/View.h:24``).
SPEC_NONE = 0
SPEC_INTERPOLATED = 1
SPEC_KEY = 2

#: ``MovieAsPyList`` slots (``packages/engine/layer1/Movie.cpp:504-523``).
MV_NFRAME = 0
MV_MATRIX_FLAG = 1
MV_MATRIX = 2
MV_PLAYING = 3
MV_SEQUENCE = 4
MV_CMD = 5
MV_VIEWELEM = 6

#: ``ObjectAsPyList`` slots (``packages/engine/layer1/PyMOLObject.cpp:696-703``).
OBJ_NAME = 1
OBJ_VIEWELEM_N = 12
OBJ_VIEWELEM = 13

#: ``ExecutiveGetExecObjectAsPyList`` (``packages/engine/layer3/Executive.cpp:5391-5397``):
#: ``[name, cExecObject, visible, None, objtype, <object payload>, ...]``, and
#: the payload's slot 0 is ``ObjectAsPyList``.  Slot **5**, not 4 — slot 3 is a
#: pre-1.8 compatibility hole and slot 4 is the type enum.
EXEC_TYPE = 1
EXEC_PAYLOAD = 5
#: ``enum ExecRec_t { cExecObject = 0, cExecSelection = 1, cExecAll = 2 }``
#: (``packages/engine/layer3/Executive.h:193``).  Selections serialise with a different shape
#: (``ExecutiveGetExecSeleAsPyList``) and carry no motions.
EXEC_TYPE_OBJECT = 0

#: ``MovieScene::storemask`` bits.  The ORDER IS NOT THE ORDER OF THE ARGUMENTS
#: — ``MovieSceneStore``'s parameter list is view/color/active/rep/frame but the
#: enum (``packages/engine/layer3/MovieScene.h:27-34``) is VIEW, **ACTIVE**, **COLOR**, REP,
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

#: ``MovieScene::THUMBNAIL_WIDTH/HEIGHT`` (``packages/engine/layer3/MovieScene.h:100-101``).
THUMBNAIL_WIDTH = 220
THUMBNAIL_HEIGHT = 124

#: Gutter labels.  ``MovieDrawViewElem`` (``packages/engine/layer1/Movie.cpp:1727``) passes
#: ``"camera"``; ``CMovie::draw`` (``:1845``) overlays ``"states"`` instead when
#: ``CMovie::ViewElem`` is null, because then the strip is the state axis of a
#: multi-state object and there is no camera track at all.
LABEL_CAMERA = "camera"
LABEL_STATES = "states"

#: ``CMovie::LabelIndent = DIP2PIXEL(8 * 8)`` (``packages/engine/layer1/Movie.cpp:1867``): the
#: right-hand gutter the label is drawn in, and the amount every hit test
#: subtracts from ``rect.right`` before converting x to a frame (``:1495``).
LABEL_INDENT = 64

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

    ``playing`` is ``MoviePlaying`` (``packages/engine/layer1/Movie.cpp:540``), which is false
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
        # ControlRock(-2) is documented as "query only" (packages/engine/layer1/Control.cpp:415).
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

    ``packages/engine/layer1/View.cpp:393-401`` writes the lexicon string when flagged and the
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


def _float_list(value: Any) -> Optional[List[float]]:
    if not isinstance(value, (list, tuple)):
        return None
    return [float(item) for item in value]


def _number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, str):
        return None
    return float(value)


def key_frame_payload(element: Optional[Sequence[Any]]) -> Dict[str, Any]:
    """Decode ONE ``ViewElemAsPyList`` (``packages/engine/layer1/View.cpp:341-424``) in full.

    Everything ``CViewElem`` (``packages/engine/layer1/View.h:24-56``) holds, in the order the
    struct declares it — the 4x4 matrix, the pre/post translations, the clip
    planes, ortho, view_mode, specification_level, the scene key, power, bias
    and state.  :func:`movie_panel` deliberately reports only the three fields
    the timeline draws with; this is the key-frame INSPECTOR, one frame at a
    time, so the full 21-slot list is worth decoding.

    TWO THINGS THE C GETS WRONG, reproduced faithfully rather than repaired,
    because a getter that "fixes" them would disagree with the session file the
    same engine writes:

    * slots 7/8 (``front``/``back``) are guarded by ``view->post_flag``, not
      ``clip_flag`` (``View.cpp:372``).  A key frame with clip planes and no
      post translation therefore serialises ``clipFlag=1`` with
      ``front=None``, and ``ViewElemFromPyList`` reads the flag back with no
      values behind it.
    * slot 16 (``power``) is guarded by ``view->ortho_flag``, not
      ``power_flag`` (``View.cpp:404``), so ``mview store, power=-1`` round
      trips as ``powerFlag=1, power=None`` unless an ortho was stored too.

    AND ONE THING THAT IS SIMPLY NOT THERE: ``timing_flag``/``timing``
    (``View.h:50-51``) have **no slot** — ``ViewElemAsPyList`` builds
    ``PyList_New(21)`` and fills 0..20, none of which is timing.  It is
    therefore unreachable from Python by any route: ``get_session`` is the only
    structured readout of a ``CViewElem`` and this is the only serialiser it
    uses.  ``VE_LENGTH`` is asserted by the tests so a future upstream merge
    that adds the slot shows up as a failure rather than as silence.
    """
    if not element:
        return {"specLevel": SPEC_NONE, "present": False}
    return {
        "present": True,
        "specLevel": int(element[VE_SPEC_LEVEL]),
        "matrixFlag": bool(int(element[VE_MATRIX_FLAG])),
        "matrix": _float_list(element[VE_MATRIX]),
        "preFlag": bool(int(element[VE_PRE_FLAG])),
        "pre": _float_list(element[VE_PRE]),
        "postFlag": bool(int(element[VE_POST_FLAG])),
        "post": _float_list(element[VE_POST]),
        "clipFlag": bool(int(element[VE_CLIP_FLAG])),
        "front": _number(element[VE_FRONT]),
        "back": _number(element[VE_BACK]),
        "orthoFlag": bool(int(element[VE_ORTHO_FLAG])),
        "ortho": _number(element[VE_ORTHO]),
        "viewMode": int(element[VE_VIEW_MODE]),
        "sceneFlag": bool(int(element[VE_SCENE_FLAG])),
        "scene": _scene_at(element),
        "powerFlag": bool(int(element[VE_POWER_FLAG])),
        "power": _number(element[VE_POWER]),
        "biasFlag": bool(int(element[VE_BIAS_FLAG])),
        "bias": _number(element[VE_BIAS]),
        "stateFlag": bool(int(element[VE_STATE_FLAG])),
        "state": _state_at(element),
    }


def _view_elem_for(session: Dict[str, Any], obj: str) -> Optional[Sequence[Any]]:
    """The ``ViewElem`` VLA of the camera (``obj == ''``) or of one object."""
    if not obj:
        movie = session.get("movie") or []
        return movie[MV_VIEWELEM] if len(movie) > MV_VIEWELEM else None
    for entry in session.get("names") or []:
        if not entry or len(entry) <= EXEC_PAYLOAD:
            continue
        if entry[EXEC_TYPE] != EXEC_TYPE_OBJECT or str(entry[0]) != obj:
            continue
        payload = entry[EXEC_PAYLOAD]
        if not isinstance(payload, (list, tuple)) or not payload:
            return None
        header = payload[0]
        if not isinstance(header, (list, tuple)) or len(header) <= OBJ_VIEWELEM:
            return None
        return header[OBJ_VIEWELEM] or None
    return None


def movie_key_frames(
    cmd: Optional[Any] = None,
    object: str = "",  # noqa: A002 - the wire name matches cmd.mview's argument
    first: int = 1,
    last: int = 0,
    session: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Full ``CViewElem`` payloads for a 1-based frame range.

    ``object=''`` is the camera track (``CMovie::ViewElem``); any other name is
    that object's own track, the same split ``ExecutiveMotionView``
    (``packages/engine/layer3/Executive.cpp:437``) makes.  ``last=0`` means "to the end".

    This is the read side of the key-frame inspector: the timeline gets its
    per-frame ``specification_level`` from the much cheaper
    :func:`movie_panel`, and only the selected cell is decoded here.
    """
    cmd = _resolve(cmd)
    nframes = int(cmd.count_frames())
    session = _session(cmd) if session is None else session
    view_elem = _view_elem_for(session, str(object))

    first = max(1, int(first))
    last = nframes if int(last) <= 0 else min(int(last), nframes)
    frames: List[Dict[str, Any]] = []
    for frame in range(first, last + 1):
        payload = key_frame_payload(_elem(view_elem, frame - 1))
        payload["frame"] = frame
        frames.append(payload)
    return {
        "object": str(object),
        "nframes": nframes,
        "track": bool(view_elem),
        "first": first,
        "last": last,
        "frames": frames,
        # ``ViewElemAsPyList`` is ``PyList_New(21)``; timing has no slot.
        "slots": VE_LENGTH,
        "timingExposed": False,
    }


def _object_rows(session: Dict[str, Any], nframes: int) -> List[Dict[str, Any]]:
    """One row per object carrying motions — ``ExecutiveMotionDraw`` parity.

    ``packages/engine/layer3/Executive.cpp:692`` emits a row for every object whose
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
                # ``ObjectDrawViewElem`` (``packages/engine/layer1/PyMOLObject.cpp``) passes
                # ``obj->Name`` to ``ViewElemDraw`` as the gutter label.
                "label": str(name),
                "spec": _spec_levels(view_elem, nframes),
                "scenes": [_scene_at(_elem(view_elem, i)) for i in range(nframes)],
            }
        )
    return rows


def movie_panel(
    cmd: Optional[Any] = None, objects: int = 1, session: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """The movie timeline: cells, spec levels, per-frame commands and rows.

    ROW SET = ``ExecutiveMotionDraw`` (``packages/engine/layer3/Executive.cpp:697``), which is
    *not* "camera plus objects" unconditionally:

    * the camera row exists only when ``MovieGetSpecLevel(G,0) >= 0``, i.e. when
      ``CMovie::ViewElem`` is allocated — one ``mview store`` is enough;
    * every object whose ``ObjectGetSpecLevel >= 0`` adds a row;
    * if that yields **nothing** and ``SceneGetNFrame() > 1``,
      ``ExecutiveCountMotions`` (``:684``) forces the count to 1 and
      ``CMovie::draw`` (``packages/engine/layer1/Movie.cpp:1845``) labels that single strip
      ``states`` instead of ``camera``, because it is the state axis of a
      multi-state object, not a camera track;
    * ``presentation`` collapses the panel to the camera row alone
      (``Executive.cpp:711-720`` sets ``expected = 1`` and ``goto done``;
      ``MovieGetPanelHeight`` returns one ``row_height``).

    ``height`` is the LAYOUT height the web timeline uses,
    ``movie_panel_row_height * len(rows)``.  It is deliberately **not**
    ``MovieGetPanelHeight``: the bridge sets ``movie_panel 0`` at startup
    (``engine.py:183``) so the C panel never steals viewport pixels from
    ``OrthoReshape``, which makes the real ``MovieGetPanelHeight`` permanently
    0.  ``panelActive`` reports that C answer separately, so nothing has to
    guess which of the two it is looking at.
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

    camera_row: Dict[str, Any] = {
        "object": "",
        "label": LABEL_CAMERA,
        "spec": _spec_levels(view_elem, nframes),
        "scenes": [_scene_at(_elem(view_elem, i)) for i in range(nframes)],
    }
    has_camera = bool(view_elem)

    rows: List[Dict[str, Any]] = [camera_row] if has_camera else []
    if int(objects):
        rows.extend(_object_rows(session, nframes))

    presentation = bool(cmd.get_setting_boolean("presentation"))
    if not rows:
        # ``ExecutiveCountMotions``' floor, and the ``states`` label that goes
        # with it (``packages/engine/layer1/Movie.cpp:1845``: ``if (!ViewElem)``).
        if nframes > 1:
            rows = [dict(camera_row, label=LABEL_STATES)]
    elif presentation and has_camera:
        rows = rows[:1]

    row_height = 0
    try:
        row_height = int(cmd.get_setting_int("movie_panel_row_height"))
    except Exception:  # noqa: BLE001
        row_height = 0

    # ``MovieGetPanelHeight`` (``packages/engine/layer1/Movie.cpp:1701``): the setting is an
    # int, and a non-zero setting still yields nothing unless there is a movie
    # program or a multi-frame scene.
    panel_setting = 0
    try:
        panel_setting = int(cmd.get_setting_int("movie_panel"))
    except Exception:  # noqa: BLE001
        panel_setting = 0
    panel_active = bool(panel_setting) and (
        bool(int(cmd.get_movie_length())) or nframes > 1
    )

    return {
        "nframes": nframes,
        "cells": cells,
        "rows": rows,
        "visible": bool(cmd.get_setting_boolean("movie_panel")),
        "rowHeight": row_height,
        "height": row_height * len(rows),
        "matrix": bool(movie[MV_MATRIX_FLAG]) if len(movie) > MV_MATRIX_FLAG else False,
        # -- ``MovieDraw``/``ExecutiveCountMotions`` parity ------------------
        "motions": len(rows),
        "presentation": presentation,
        "label": rows[0]["label"] if rows else LABEL_STATES,
        "labelIndent": LABEL_INDENT,
        "panelActive": panel_active,
        "panelHeight": (row_height if presentation else row_height * len(rows))
        if panel_active
        else 0,
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
    ``MovieScenesAsPyList`` (``packages/engine/layer3/MovieScene.cpp:918``) via the same
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
    # ``PConvArgsToPyList(order, dict)`` (``packages/engine/layer3/MovieScene.cpp:919``) is
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
    to ``SceneDeferImage`` (``packages/engine/layer3/MovieScene.cpp:225-232``), so a read that
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
    (``packages/engine/layer1/Movie.cpp:865``), and until the pump has drawn enough times to
    finish the export **every other API call raises**
    ``APIEnterNotModal``.  Measured here: the very next ``cmd.count_atoms``
    after a modal ``mpng`` raised ``Error: APIEnterNotModal(G)``; the modal
    state cleared 0.16 s later and the engine was intact.  With ``modal=0``
    ``MoviePNG`` runs its own ``while(!M->complete)`` loop
    (``packages/engine/layer1/Movie.cpp:872-875``) inside one pump task, so the engine is never
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

    ``packages/engine/modules/pymol/movie.py:824`` is the same probe the Qt dialog uses to grey
    out a format (``packages/engine/modules/pmg_qt/file_dialogs.py:691``).
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
# encoded export -- `movie.produce`
# --------------------------------------------------------------------------

#: Extensions ``movie.produce`` hands to ``mpeg_encode``
#: (``packages/engine/modules/pymol/movie.py:916``).
MPEG_EXTENSIONS: Tuple[str, ...] = (".mpeg", ".mpg")

#: Extensions whose dimensions ``produce`` forces even (``:939``).  H.264 and
#: VP9 both need a macroblock-aligned frame; an odd width silently fails inside
#: ffmpeg instead of inside PyMOL.
EVEN_EXTENSIONS: Tuple[str, ...] = (".mp4", ".mov", ".webm")

#: ``_encode``'s legal MPEG-1 frame rates (``packages/engine/modules/pymol/movie.py:736``).
FPS_LEGAL_VALUES: Tuple[float, ...] = (23.976, 24, 25, 29.97, 30, 50, 59.94, 60)


def produce_plan(
    cmd: Optional[Any] = None,
    filename: str = "",
    encoder: str = "",
    quality: int = -1,
    width: int = 0,
    height: int = 0,
) -> Dict[str, Any]:
    """Everything ``movie.produce`` decides before it renders a single frame.

    ``produce`` makes six decisions and reports none of them: it returns
    ``DEFAULT_SUCCESS`` (``None``) and prints.  A browser form has to know all
    six *before* the button is pressed — which encoder will be picked, whether
    it exists, what the frames will be called, and what the output dimensions
    will actually be — so this reproduces the arithmetic of
    ``packages/engine/modules/pymol/movie.py:906-951``, with the line numbers:

    ``:906-910``  ``splitext``; an empty extension becomes ``.mpg``
    ``:915-925``  encoder guess: ``.mpg``/``.mpeg`` -> mpeg_encode, else
                  ffmpeg, else convert, else ``CmdException``
    ``:928-933``  mpeg_encode -> ``.ppm`` frames, anything else -> ``.png``
    ``:939-951``  ``.mp4``/``.mov``/``.webm`` -> even, aspect-preserving size
    ``:901-904``  ``quality < 0`` -> ``movie_quality``, clamped to 100

    and the two per-encoder mappings out of ``_encode`` (``:732``, ``:779``,
    ``:783``, ``:799``) so the dialog can show the command it is about to run.

    ONE DELIBERATE DIVERGENCE, in ``:943-947``.  When exactly one of
    width/height is given, upstream derives the other with true division and
    keeps the FLOAT — ``201 * 600 / 800`` is ``150.75``, ``150.75 % 2`` is
    truthy, so it "evens" it to ``149.75`` and ``mpng`` renders an **odd**
    200x149 frame that ffmpeg then refuses.  MEASURED: ``cmd.movie.produce(f,
    mode='ray', width=201)`` writes 200x149 PNGs, ffmpeg exits 187 and the
    ``.mp4`` is 0 bytes; the same request here truncates with ``int()`` first,
    renders 200x150 and encodes.  Pinned by
    ``packages/bridge/tests/test_wf_movieverify.py``.
    """
    cmd = _resolve(cmd)
    import pymol.movie as pymol_movie  # noqa: WPS433

    stem, ext = os.path.splitext(str(filename))
    if ext == "":
        ext = ".mpg"
    resolved_name = stem + ext
    tmp_path = stem + ".tmp"

    quality = int(quality)
    if quality < 0:
        quality = int(cmd.get_setting_int("movie_quality"))
    if quality > 100:
        quality = 100

    encoder = str(encoder)
    guessed = False
    if not encoder:
        guessed = True
        if ext in MPEG_EXTENSIONS:
            encoder = "mpeg_encode"
        elif pymol_movie.find_exe("ffmpeg"):
            encoder = "ffmpeg"
        elif pymol_movie.find_exe("convert"):
            encoder = "convert"
        else:
            encoder = ""

    img_ext = ".ppm" if encoder == "mpeg_encode" else ".png"
    known = encoder in ("ffmpeg", "convert", "mpeg_encode")
    exe = pymol_movie.find_exe(encoder) if known else None
    if encoder == "mpeg_encode":
        # ``_encode`` does not use ``find_exe`` here: it asks the bundled
        # ``pymol.mpeg_encode`` shim to validate itself (``:726``).
        try:
            from pymol import mpeg_encode as _mpeg  # noqa: WPS433

            exe = _mpeg.validate()
        except Exception:  # noqa: BLE001
            exe = None

    width, height = int(width), int(height)
    viewport = [int(v) for v in cmd.get_viewport()]
    if ext in EVEN_EXTENSIONS:
        if width < 1 or height < 1:
            w, h = viewport
            if width > 0:
                height = int(width * h / w)
            elif height > 0:
                width = int(height * w / h)
            else:
                width, height = w, h
        if width % 2:
            width -= 1
        if height % 2:
            height -= 1

    fps = float(pymol_movie.get_movie_fps(cmd))
    fps_legal = min(FPS_LEGAL_VALUES, key=lambda v: abs(v - fps))

    return {
        "filename": resolved_name,
        "ext": ext,
        "tmpdir": tmp_path,
        "framePrefix": pymol_movie._prefix,
        "frameExt": img_ext,
        "frameGlob": "%s%%04d%s" % (pymol_movie._prefix, img_ext),
        "encoder": encoder,
        "encoderGuessed": guessed,
        "encoderPath": exe,
        "known": known,
        "available": bool(exe),
        "quality": quality,
        "width": width,
        "height": height,
        "viewport": viewport,
        "fps": fps,
        # ``_encode:732`` - mpeg_encode's own 1..30 scale, inverted.
        "mpegQuality": 1 + int(((100 - quality) * 29) / 100),
        "fpsLegal": fps_legal,
        "fpsAdjusted": fps_legal != round(fps, 3),
        # ``_encode:779`` webm / ``:783`` everything else through ffmpeg.
        "crf": (
            "%.0f" % (65 - (quality / 2))
            if ext == ".webm"
            else ("10" if quality > 90 else "15" if quality > 80 else "20")
        ),
        # ``_encode:799`` convert's inter-frame delay, in 1/100 s.
        "convertDelay": "%.3f" % (100.0 / fps) if fps else None,
        "twoPassPalette": ext == ".gif" and encoder == "ffmpeg",
    }


class _ModalOverride:
    """``pymol.cmd`` with ``mpng``'s ``modal`` argument pinned.

    ``produce`` hard-codes ``modal=-1`` (``packages/engine/modules/pymol/movie.py:973``) and
    ``MoviePNG`` treats any non-zero ``modal`` as "install ``MovieModalDraw``"
    (``packages/engine/layer1/Movie.cpp:836-865``) unless the mode is ray.  **Measured over the
    socket:** after a plain ``cmd.movie.produce('x.mp4', mode='draw')`` the very
    next call raised ``Error: APIEnterNotModal(G)`` — the same blocker-A2
    window ``movie_export_png`` already refuses to open for the PNG path.

    ``produce`` takes ``_self``, so the fix needs no monkey-patching and no
    fork of the 90-line function: hand it a proxy whose only difference is the
    ``modal`` it passes on.  With ``modal=0`` ``MoviePNG`` runs its own
    ``while(!M->complete)`` loop inside this one pump task, ``produce`` then
    sees ``get_modal_draw() == 0`` and runs ``_encode`` inline instead of on a
    daemon thread (``:982-987``) -- so when the call returns the file is on
    disk and the temp directory is already gone.

    The cost is honest and stated: the pump is busy for the whole export
    instead of for none of it.  ``modal=1`` restores upstream's fire-and-forget
    behaviour for callers that would rather have the window.
    """

    def __init__(self, cmd: Any, modal: int) -> None:
        self._cmd = cmd
        self._modal = int(modal)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cmd, name)

    def mpng(self, *args: Any, **kwargs: Any) -> Any:
        """Forward to ``cmd.mpng`` while overriding its ``modal`` argument.

        The one method the proxy intercepts: forcing ``modal`` (typically 0)
        makes ``produce`` render and encode inline inside this pump task rather
        than spawning the modal draw window and a daemon encode thread.
        """
        kwargs["modal"] = self._modal
        return self._cmd.mpng(*args, **kwargs)


def movie_produce(
    cmd: Optional[Any] = None,
    filename: str = "",
    mode: str = "",
    first: int = 0,
    last: int = 0,
    preserve: int = 0,
    encoder: str = "",
    quality: int = -1,
    quiet: int = 0,
    width: int = 0,
    height: int = 0,
    modal: int = 0,
) -> Dict[str, Any]:
    """``cmd.movie.produce`` with a plan, no modal window, and a real answer.

    Three things ``produce`` itself will not give a browser:

    1. **A result.**  It returns ``DEFAULT_SUCCESS`` (``None``) whether ffmpeg
       wrote 2 MB or exited 1; the only evidence is console text.  This returns
       the plan plus ``ok``/``bytes``, so the dialog can say "wrote 2,023 bytes"
       or "compression failed" without scraping the feedback stream.
    2. **No ``APIEnterNotModal`` window** -- see :class:`_ModalOverride`.
    3. **Resolved dimensions.**  The even-forcing of ``:948-951`` happens
       inside ``produce`` and is never reported; here the plan computes it,
       the already-even numbers are what gets passed down, and the caller is
       told what they were.

    Everything else is upstream's, unchanged: the encoder guess, the ``.ppm``
    vs ``.png`` frames, ``set opaque_background``, ``set keep_alive`` for the
    duration, the temp directory and its removal unless ``preserve``.
    ``CmdException`` for an unknown or missing encoder is left to propagate,
    because that is the message the user should see.
    """
    cmd = _resolve(cmd)
    import pymol.movie as pymol_movie  # noqa: WPS433

    plan = produce_plan(
        cmd, filename=filename, encoder=encoder, quality=quality,
        width=width, height=height,
    )

    # An empty filename is a DRY RUN, not `.mpg` in the current directory.
    # ``produce`` would happily take ``os.path.splitext('') -> ('', '')``, turn
    # it into ``.mpg``, create a ``.tmp`` directory beside the process cwd and
    # render the whole movie into it before failing; a capability probe that
    # calls every exported symbol with no arguments must not do that.
    if not str(filename):
        return dict(
            plan,
            ok=False,
            bytes=0,
            modal=int(modal),
            preserve=int(preserve),
            tmpdirExists=False,
            frames=[],
            skipped=True,
        )

    directory = os.path.dirname(plan["filename"]) or "."
    try:
        os.makedirs(directory, exist_ok=True)
    except OSError:
        pass

    proxy = _ModalOverride(cmd, modal)
    try:
        pymol_movie.produce(
            plan["filename"],
            mode=mode,
            first=int(first),
            last=int(last),
            preserve=int(preserve),
            # Pass the RESOLVED encoder: with an empty string produce would
            # guess again, and a guess that disagreed with the plan would make
            # every number reported here a lie.
            encoder=plan["encoder"],
            quality=plan["quality"],
            quiet=int(quiet),
            width=plan["width"],
            height=plan["height"],
            _self=proxy,
        )
    finally:
        # ``_encode:811`` is the only ``unset("keep_alive")`` there is, and it
        # is not reached if ``mpng`` raises -- which would leave the engine
        # pinned awake for the rest of the session.  Only safe to force when
        # the export was synchronous; with ``modal=1`` the encode is still
        # running on its own thread and owns the setting.
        if not int(modal):
            try:
                cmd.unset("keep_alive")
            except Exception:  # noqa: BLE001
                pass

    out = dict(plan)
    exists = os.path.exists(plan["filename"])
    out.update(
        {
            "ok": exists and os.path.getsize(plan["filename"]) > 0,
            "bytes": os.path.getsize(plan["filename"]) if exists else 0,
            "modal": int(modal),
            "preserve": int(preserve),
            "tmpdirExists": os.path.isdir(plan["tmpdir"]),
            "frames": sorted(_listdir(plan["tmpdir"])),
        }
    )
    return out


# --------------------------------------------------------------------------
# installation
# --------------------------------------------------------------------------

#: wire name -> implementation.  Every name is public and two segments, so the
#: capability policy admits it with no ``policy/grants/`` entry (plan §A6:
#: root ``cmd`` is granted, private *leaves* are the only thing gated).
EXPORTS: Dict[str, Any] = {
    "get_movie_status": movie_status,
    "get_movie_panel": movie_panel,
    "get_movie_key_frames": movie_key_frames,
    "get_scene_panel": scene_panel,
    "get_scene_thumbnail_png": scene_thumbnail_png,
    "movie_export_png": movie_export_png,
    "get_movie_encoders": movie_encoders,
    "get_movie_produce_plan": produce_plan,
    "movie_produce": movie_produce,
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
    """Remove the :data:`EXPORTS` this module bound onto ``cmd``; return their names.

    Only deletes attributes whose ``__wrapped__`` is one of our exports, so
    unrelated ``cmd`` members are left alone.
    """
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
