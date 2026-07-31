"""Mode P: read the offscreen FBO back after each draw and push encoded frames.

Plan §1.3 / §6 WP-04.  This is the *correctness baseline* of the whole product:
every rep renders exactly as PyMOL renders it, because it is PyMOL rendering
it.  Mode G (``modeg.py``) is developed alongside it, per rep, with automatic
fallback to here.

THE TICK
--------
``Pump`` runs, in this order, on the engine thread::

    drain the FIFO (client commands, mouse input)
    engine.tick()      ->  p.idle() ; p.draw()
    tick hooks         ->  FrameStream.on_tick(engine)   <- we are here

so by the time :meth:`FrameStream.on_tick` runs the framebuffer already holds
the current frame and one ``glReadPixels`` is all that is left.

WHY THE DIRTY GATE IS A PRE-DRAW PROBE AND NOT A TICK HOOK  (measured)
---------------------------------------------------------------------
``PyMOL_Draw`` sets ``I->RedisplayFlag = false`` at ``layer5/PyMOL.cpp:2331``
**before** it calls ``ExecutiveDrawNow``.  So a tick hook — which runs *after*
the draw — sees the flag already cleared for the very frame it is about to
send, and ``getRedisplay()`` polled there returns ``False`` for every real
change.  Gating emission on it would produce a viewport that never updates.
Desktop PyMOL has the same ordering constraint and solves it the same way: the
Qt widget polls ``PyMOL_GetRedisplay`` from the idle loop and only then calls
``update()`` -> ``paintGL`` -> ``PyMOL_Draw``.

:class:`RedisplayGate` therefore probes ``PyMOL_GetRedisplay(reset=1)``
*immediately before* ``engine.tick()``.  It reaches that position through
``pump.add_pre_tick_hook`` when the pump offers one (it does not today) and
otherwise by wrapping the bound ``engine.tick`` on the instance — reversibly,
loudly, and only while attached.  The gate is also the process's **single**
consumer of that destructive flag (plan §1.2), and fans it out to sinks so
WP-03's ``redisplay`` topic does not open a second drain.

TRANSPORT POLICY (plan §1.3, verbatim)
--------------------------------------
* JPEG q80 while the camera moves; lossless PNG once it settles.
* Frames are **dropped, never queued**: at most :attr:`StreamParams.max_in_flight`
  un-acked frames per client, with :attr:`StreamParams.ack_timeout_s` as the
  liveness escape hatch so a client that never acks degrades to "no flow
  control" instead of to a frozen viewport.
* Under sustained backpressure the JPEG quality walks down
  (:class:`~tenmol_bridge.render.encode.AdaptiveQuality`) before frames start
  being skipped.
* ``cmd.ray`` is an explicit high-quality mode, not something the stream ever
  does on its own.

DEFECT D2 — MODE P AND MODE G MUST NOT BOTH DRAW THE SAME REP
-------------------------------------------------------------
``PixelFrameHeader.reps`` is the contract: *these are the reps that are in this
bitmap*.  Anything not in that list is the client's to draw.  It used to be
absent on every frame, which by the protocol's own rule ("absent means the
whole scene") meant Mode G was compositing a second copy of geometry PyMOL had
already rasterised — invisible on opaque cartoon, wrong on anything with
alpha, and a complete waste of Mode G.

This module now populates it, and where it can, stops drawing the masked reps
at all.  Three things were measured before choosing the mechanism, all on this
tree with a real GL context (transcripts in the WP report):

1. ``cmd.hide(rep)`` — the obvious per-rep mask — **destroys the geometry Mode
   G renders**.  With ``cartoon`` hidden, ``_cmd.web_get_rep_geometry`` returns
   ``status='not-built'``: PyMOL frees the ``Rep`` and there is nothing left to
   serialise.  Hiding a rep server-side to let the client draw it is therefore
   self-defeating.
2. Applying ``hide``/``show`` transiently around each readback (so the user's
   state is never observable) forces a full rep REBUILD every frame: measured
   **85.8 ms/frame** for ``cartoon`` and **512.5 ms/frame** for ``surface`` on
   1AON, against 0.043 ms for an unmasked tick.  Not a trade-off, a non-starter.
3. ``cmd.disable(object)`` **keeps every Rep built** (the accessor still answers
   ``ok``) and removes the object from the render.  Measured cost of
   ``disable + draw + enable`` on 1AON, 58,870 atoms: **0.023 ms**, against
   0.037 ms for the bare draw it replaces.  Free.

So the render-time mask is **transient and object-granular**:

    disable the objects the client is drawing  ->  draw  ->  glReadPixels
    ->  enable them again

all between two statements on the engine thread, which is the only thread
allowed to touch PyMOL (plan §1.1).  No observer can see it: the status thread
calls only ``get_progress`` / ``_get_feedback`` / ``get_setting_updates``, none
of which read visibility, and every client command is drained at the top of the
NEXT tick.  ``cmd.ray``, the backend pick pass and session save all run outside
that window and always see the full scene.  **The user's show/hide state is
never written.**

An object is masked only when EVERY rep it is currently drawing is one the
client declared (``geometryReps``), because ``disable`` is all-or-nothing per
object.  A partially covered object stays in the bitmap in full and the client
suppresses its Mode-G copy instead — same end state (drawn exactly once), just
drawn by the server.  ``plan_mask`` runs a small fixed point so that the set of
reps in the bitmap and the set of reps the client draws are always DISJOINT,
which is what makes a single flat ``reps`` list sufficient.

DEPTH: THE COMPOSITION RULE, AND WHY THERE IS NO DEPTH CHANNEL
--------------------------------------------------------------
A Mode-P frame is a flat bitmap.  The client blits it to a 2-D canvas and
draws Mode G over it, so composition is **painter's order: every Mode-G object
is in front of every Mode-P object**.  Because the mask is per object and the
fixed point keeps the two rep sets disjoint, nothing is ever drawn twice and
nothing is ever lost — but a Mode-P object cannot occlude a Mode-G one.

Shipping a depth channel would fix that.  Measured here at 1280x960 on 1AON,
against a 3.4 ms colour frame:

===========================  =========  ==========  ==============================
channel                      readback   compress    bytes
===========================  =========  ==========  ==============================
colour RGBA (the baseline)   0.481 ms   1.7 ms      182,717  (jpeg q80)
depth ``GL_UNSIGNED_SHORT``  0.667 ms   7.9 ms      439,158  (zlib L1, lossless)
depth 8-bit (high byte)      0.667 ms   3.0 ms      122,735  (zlib L1)
===========================  =========  ==========  ==============================

i.e. +2.5x to +4x frame time and +0.7x to +2.4x bytes, for correct occlusion in
the one configuration (a Mode-P object interpenetrating a Mode-G object) that
the object-granular mask makes rare.  **Not shipped.**  The stated limitation is
cheaper, and the real fix is to move the remaining reps to Mode G, which is the
direction the product is going anyway.

THE GL-FREE SHORT CIRCUIT
-------------------------
When the client's declaration covers every rep in the scene there is nothing
left for PyMOL to rasterise.  The stream then sends **one** background-only
frame (produced by the same mask path, with every object disabled, so gradients
and ``bg_rgb`` are exactly PyMOL's) and after that emits nothing at all: no
draw, no ``glReadPixels``, no encode.  That is the state the product owner is
betting on — with picking client-side, a backend in this state never touches
GL.  :meth:`FrameStream.stats` reports it as ``mask.rasterizing = false``.
"""

from __future__ import annotations

import collections.abc
import contextlib
import ctypes
import json
import sys
import threading
import time
from dataclasses import dataclass, field
from typing import (
    Any,
    Callable,
    Dict,
    FrozenSet,
    Iterator,
    List,
    Optional,
    Sequence,
    Tuple,
)

from ..config import log
from ..errors import BridgeError, NoOffscreenGL, PyMOLUnavailable
from ..session import HEADER_ALIGNMENT, encode_binary_frame
from . import encode as _encode
from .encode import AdaptiveQuality, EncodedImage

__all__ = [
    "StreamParams",
    "RedisplayGate",
    "PixelReadback",
    "Subscriber",
    "FrameStream",
    "SceneCoverage",
    "CoverageProbe",
    "MaskPlan",
    "plan_mask",
    "normalise_reps",
    "pixel_frame_header",
    "REP_COUNT",
    "TOPIC_PIXELS",
]

#: The topic this module publishes descriptors on (``session.TOPIC_PIXELS``).
TOPIC_PIXELS = "pixels"

# -- GL enums we need; identical in the EXT and ARB namespaces ---------------
_GL_RGBA = 0x1908
_GL_UNSIGNED_BYTE = 0x1401
_GL_COLOR_ATTACHMENT0 = 0x8CE0
_GL_PACK_ALIGNMENT = 0x0D05
_GL_FRAMEBUFFER = 0x8D40


# --------------------------------------------------------------------------- #
# Rep identity (a local mirror so this module stays importable without PyMOL)
# --------------------------------------------------------------------------- #

#: ``cRepCnt``, ``layer1/Rep.h:73``.  Mirrored, not imported, so ``encode.py``'s
#: "no PyMOL, no GL" property holds for this module's pure parts too.
REP_COUNT = 21

#: Legal values of :attr:`StreamParams.mask_mode`.
MASK_MODES = ("object", "off")


def _rep_id(value: Any) -> int:
    """``5`` / ``'cartoon'`` -> ``5``.  Raises for anything else."""
    if isinstance(value, bool):  # bool is an int; a bool rep id is a bug
        raise BridgeError("rep must be an index or a name, not a bool")
    if isinstance(value, int):
        return int(value)
    from .modeg import rep_id  # local: keeps the import graph acyclic

    return int(rep_id(value))


def normalise_reps(values: Any) -> Tuple[int, ...]:
    """Sorted, de-duplicated, in-range ``cRep_t`` indices.

    Out-of-range values are DROPPED rather than clamped: a rep this build does
    not have is a rep the client cannot be drawing, and silently turning it
    into rep 0 (``sticks``) would mask the wrong thing.
    """
    if values is None:
        return ()
    if isinstance(values, (str, bytes)) or not isinstance(
        values, collections.abc.Iterable
    ):
        values = [values]
    out: set = set()
    for value in values:
        try:
            index = _rep_id(value)
        except Exception:  # noqa: BLE001 - a bad entry must not kill the stream
            log("ignoring unrecognised rep %r in geometryReps" % (value,))
            continue
        if 0 <= index < REP_COUNT:
            out.add(index)
        else:
            log("ignoring out-of-range rep %r in geometryReps" % (value,))
    return tuple(sorted(out))


# --------------------------------------------------------------------------- #
# Scene coverage: which reps is each enabled object actually drawing?
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class SceneCoverage:
    """``{object name: the reps it is currently drawing}``, enabled objects only.

    ``exact`` is False when the probe could not run (no PyMOL, an exception).
    An inexact coverage disables masking entirely and reports the bitmap as the
    whole scene, which is the safe direction: the client then draws nothing in
    Mode G and sees a correct, if server-rendered, picture.
    """

    objects: Dict[str, FrozenSet[int]] = field(default_factory=dict)
    exact: bool = False
    source: str = "none"
    cost_ms: float = 0.0
    at: float = 0.0

    def visible_reps(self) -> FrozenSet[int]:
        out: set = set()
        for reps in self.objects.values():
            out |= reps
        return frozenset(out)

    def to_json(self) -> Dict[str, Any]:
        return {
            "exact": self.exact,
            "source": self.source,
            "costMs": round(self.cost_ms, 3),
            "objects": {name: sorted(reps) for name, reps in self.objects.items()},
            "visibleReps": sorted(self.visible_reps()),
        }


class CoverageProbe:
    """Reads the scene's per-object rep visibility.  Engine thread only.

    WHY NOT ``_cmd.web_get_versions``.  It reports exactly this, per
    ``(object, rep, state)``, in 1.5 us — but its ``changed`` flag is
    **one-shot**, measured::

        poll #1 after `show sticks`   changed=True
        poll #2 after `show sticks`   changed=False
        poll #3 after `show sticks`   changed=False

    ``render/modeg.py`` gates the whole of defect D1 on that flag, so a second
    consumer here would silently eat its invalidations — the same hazard plan
    §1.2 documents for ``_get_feedback`` / ``getRedisplay`` / setting updates.
    This probe therefore uses only non-destructive calls:

    * ``cmd.get_vis()`` — 0.001 ms — gives the enabled flag and the OBJECT-level
      ``visRep`` (``ExecutiveGetVisAsPyDict``, ``layer3/Executive.cpp:4496``),
      which is where ``cell``/``extent`` live for a molecule and where the whole
      rep set lives for a distance/angle/CGO object;
    * one ``cmd.iterate('enabled', ...)`` OR-ing the per-atom ``visRep`` per
      object — 8.1 ms on 58,870 atoms, 0.2 ms on 1,435.

    The iterate is the expensive half, so it runs only when the scene is dirty
    and at most every :attr:`StreamParams.coverage_scan_ms`.
    """

    #: `cmd.get_vis()` gives a 4-list per record; index 2 is the rep index list
    #: and is ``None`` for anything that is not a cExecObject (i.e. selections).
    _VIS_REPS = 2
    _VIS_ENABLED = 0

    def __init__(self) -> None:
        self.last = SceneCoverage()
        self.probes = 0
        self.errors = 0
        self.last_error: Optional[str] = None
        self.total_ms = 0.0

    def stale(self, now: float, scan_ms: float) -> bool:
        if not self.last.exact:
            return True
        return (now - self.last.at) * 1000.0 >= scan_ms

    def probe(self, engine: Any) -> SceneCoverage:
        cmd = getattr(engine, "cmd", None)
        if cmd is None:
            self.last = SceneCoverage(source="no-pymol", at=time.monotonic())
            return self.last
        t0 = time.perf_counter()
        try:
            vis = cmd.get_vis() or {}
            atom_reps: Dict[str, int] = {}
            cmd.iterate(
                "enabled",
                "acc[model] = acc.get(model, 0) | reps",
                space={"acc": atom_reps},
            )
        except Exception as exc:  # noqa: BLE001 - never take the pump down
            self.errors += 1
            self.last_error = repr(exc)
            log("coverage probe raised %r" % (exc,))
            self.last = SceneCoverage(source="error", at=time.monotonic())
            return self.last

        objects: Dict[str, FrozenSet[int]] = {}
        for name, entry in vis.items():
            try:
                if not isinstance(entry, (list, tuple)) or len(entry) <= self._VIS_REPS:
                    continue
                object_reps = entry[self._VIS_REPS]
                if object_reps is None:
                    continue  # a selection record, not an object
                if not entry[self._VIS_ENABLED]:
                    continue  # disabled: it draws nothing, mask or no mask
                reps = {int(r) for r in object_reps if 0 <= int(r) < REP_COUNT}
            except Exception:  # noqa: BLE001 - one odd record must not lose all
                continue
            bits = int(atom_reps.get(name, 0))
            reps.update(index for index in range(REP_COUNT) if (bits >> index) & 1)
            objects[str(name)] = frozenset(reps)

        cost = (time.perf_counter() - t0) * 1000.0
        self.probes += 1
        self.total_ms += cost
        self.last = SceneCoverage(
            objects=objects,
            exact=True,
            source="get_vis+iterate",
            cost_ms=cost,
            at=time.monotonic(),
        )
        return self.last

    def stats(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "probes": self.probes,
            "errors": self.errors,
            "avgMs": round(self.total_ms / self.probes, 3) if self.probes else 0.0,
        }
        payload.update(self.last.to_json())
        if self.last_error:
            payload["lastError"] = self.last_error
        return payload


# --------------------------------------------------------------------------- #
# The mask plan
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class MaskPlan:
    """What to disable before the readback, and what the frame then contains.

    ``reps is None`` means "do not put ``reps`` in the header at all", i.e. the
    protocol's "absent == the whole scene".  That is what a client that has not
    declared anything gets, and it is byte-identical to the pre-D2 header.
    """

    masked: Tuple[str, ...] = ()
    reps: Optional[Tuple[int, ...]] = None
    visible: Tuple[int, ...] = ()
    raster: bool = True
    reason: str = "no-declaration"

    def to_json(self) -> Dict[str, Any]:
        return {
            "maskedObjects": list(self.masked),
            "reps": None if self.reps is None else list(self.reps),
            "visibleReps": list(self.visible),
            "rasterizing": self.raster,
            "reason": self.reason,
        }


def plan_mask(
    coverage: SceneCoverage,
    geometry_reps: Sequence[int],
    mask_mode: str = "object",
    allow_no_raster: bool = True,
) -> MaskPlan:
    """Decide the render-time mask.  Pure — no PyMOL, no GL, fully unit-tested.

    The fixed point at the bottom is the whole reason a flat ``reps`` list is
    enough.  Consider ``A`` showing {cartoon, sticks} and ``B`` showing
    {cartoon}, with the client declaring {cartoon}:  ``B`` is fully covered so
    it is a mask candidate, but ``A`` is not, so ``cartoon`` is in the bitmap
    anyway — and a client told "cartoon is in the bitmap" would suppress its
    Mode-G cartoon and lose ``B`` entirely.  Dropping ``B`` from the mask makes
    the two sets disjoint and the picture whole.  It costs at most one pass per
    object and in the common case never loops at all.
    """
    declared = frozenset(int(r) for r in geometry_reps)
    visible = tuple(sorted(coverage.visible_reps()))

    if not declared:
        # Nothing declared: unchanged behaviour, and `reps` stays absent so an
        # old client sees exactly the header it saw before D2.
        return MaskPlan(visible=visible, raster=True, reason="no-declaration")
    if not coverage.exact:
        # We cannot see the scene, so we cannot promise anything about it.
        return MaskPlan(visible=visible, raster=True, reason="coverage-unknown")

    drawing = {name for name, reps in coverage.objects.items() if reps}
    covered = {name for name in drawing if coverage.objects[name] <= declared}

    if allow_no_raster and covered == drawing:
        # Nothing in the scene is the server's to draw.  This is the GL-free
        # state and it does NOT depend on `mask_mode`: `mask_mode` only governs
        # whether a PARTIALLY covered scene is worth masking.  The object list
        # still comes back so the one background-only frame can be produced.
        return MaskPlan(
            masked=tuple(sorted(covered)),
            reps=(),
            visible=visible,
            raster=False,
            reason="fully-covered",
        )

    candidates: set = set(covered) if mask_mode == "object" else set()

    while True:
        drawn: set = set()
        for name, reps in coverage.objects.items():
            if name not in candidates:
                drawn |= reps
        conflicting = {n for n in candidates if coverage.objects[n] & drawn}
        if not conflicting:
            break
        candidates -= conflicting

    raster = bool(drawn) or not allow_no_raster
    if not raster:
        reason = "fully-covered"
    elif mask_mode != "object":
        reason = "mask-off"
    elif candidates:
        reason = "partial"
    else:
        reason = "nothing-maskable"
    return MaskPlan(
        masked=tuple(sorted(candidates)),
        reps=tuple(sorted(drawn)),
        visible=visible,
        raster=raster,
        reason=reason,
    )


# --------------------------------------------------------------------------- #
# Stream parameters
# --------------------------------------------------------------------------- #


@dataclass
class StreamParams:
    """Everything the client can negotiate, plus the policy constants."""

    #: Codec while the scene is in motion.  1.7 ms / 183 KB at 1280x960.
    motion_encoding: str = _encode.DEFAULT_MOTION_ENCODING
    #: Codec once the scene settles.  Lossless; text, thin lines and
    #: ``ray_trace_mode`` outlines survive intact.
    settle_encoding: str = _encode.DEFAULT_SETTLE_ENCODING
    #: Ceiling for the lossy codec; :class:`AdaptiveQuality` may go below it.
    quality: int = _encode.DEFAULT_QUALITY
    #: Device pixel ratio the client is displaying at.  Reported, not applied,
    #: unless :attr:`settle_scale` is used.
    dpr: float = 1.0
    #: Multiply the framebuffer by this on settle, for a retina-crisp still.
    #: 1.0 disables the resize entirely (the default: a resize costs a full
    #: PyMOL reshape + rebuild, and 2560x1920 PNG is ~40 ms).
    settle_scale: float = 1.0
    #: Quiet time before the lossless still.  Long enough that the tail of a
    #: drag does not trigger one, short enough to feel immediate.
    settle_ms: float = 180.0
    #: Hard cap on emitted frames per second while in motion.  The pump ticks
    #: at 60 Hz; 60 fps of JPEG is 11 MB/s, which loopback carries fine, but a
    #: cap gives the encode budget somewhere to go.
    max_fps: float = 60.0
    #: At most this many un-acked frames per client.  Plan §1.3: "the bridge
    #: emits at most one un-acknowledged frame per client."
    max_in_flight: int = 1
    #: After this long an un-acked frame is treated as lost rather than as
    #: backpressure, so a client that never acks still gets a live viewport.
    ack_timeout_s: float = 0.75
    #: Outbox depth above which we skip regardless of acks.
    max_outbox: int = 4
    #: Keep the alpha channel.  Off: PyMOL's background is opaque and RGB is
    #: 8 % fewer bytes and 2.4 ms less PNG.
    alpha: bool = False
    #: Flip server-side (free — see ``encode.py``) so the payload is a normal
    #: top-down image the client can ``drawImage`` and the user can save.
    server_flip: bool = True
    #: Stop emitting entirely (tab hidden, or every rep moved to Mode G).
    paused: bool = False

    # -- defect D2: per-rep composition ------------------------------------
    #: ``cRep_t`` indices the CLIENT has declared it is drawing itself in Mode
    #: G.  The bridge never infers this: a rep it was not told about is a rep
    #: it must keep rasterising, because the alternative is a hole in the
    #: picture.  Empty (the default) reproduces the pre-D2 behaviour exactly —
    #: the whole scene is rasterised and ``PixelFrameHeader.reps`` is absent.
    geometry_reps: Tuple[int, ...] = ()
    #: ``"object"`` — in a PARTIALLY covered scene, disable the objects whose
    #: every drawn rep is declared (see the module docstring).  ``"off"`` —
    #: never touch PyMOL in that case; the bitmap stays the whole scene and the
    #: client suppresses its Mode-G copy instead.  Either way the double draw
    #: is gone; this only decides who does the drawing.
    #:
    #: It does NOT affect the fully-covered short circuit, which always fires.
    #:
    #: THE TRADE, MEASURED (1AON, 58,870 atoms, 1280x960, two objects, one
    #: masked, three seconds of continuous ``turn``):
    #:
    #:   * saving — the masked object is out of the draw.  But a Mode-P frame
    #:     is 3.19 ms readback + 2.12 ms encode + ~0.35 ms draw, and readback
    #:     and encode are RESOLUTION-bound, not scene-bound.  Masking can only
    #:     ever return the draw: ~7 % of the frame on this GPU.
    #:   * cost — ``cmd.disable``/``cmd.enable`` bump ``CExecutive``'s object
    #:     counter, so the next ``_cmd.web_get_versions`` poll re-walks every
    #:     built rep: the Mode-G scan went from **0.01 ms median to 47.80 ms
    #:     median** in that run (4 Hz x 47.8 ms = 19 % of the engine thread).
    #:
    #: So on a fast GPU this is a wash at best on huge structures.  It is a
    #: clear win wherever the DRAW is the bottleneck instead of the readback —
    #: which is exactly Linux software rendering: spike 07 measured a 320x240
    #: cartoon draw at **140-158 ms** on Mesa llvmpipe, 40x the readback.
    #: Left ON by default because that is the platform the product is trying to
    #: reach; set ``maskMode:'off'`` on a workstation with a real GPU.
    mask_mode: str = "object"
    #: Allow the "nothing left to rasterise" short circuit.  Turning this off
    #: keeps a live pixel stream running under a fully Mode-G client, which is
    #: useful when comparing the two renderers side by side.
    allow_no_raster: bool = True
    #: Floor on how often the scene-coverage probe may run.  The probe is
    #: ``cmd.get_vis()`` (0.001 ms) plus one ``cmd.iterate`` over enabled atoms
    #: (8.1 ms on 58,870 atoms, ~0.2 ms on a 1,435-atom structure), and it only
    #: runs at all when the client has declared something AND the scene is
    #: dirty.  250 ms matches ``RenderService.scan_every``.
    coverage_scan_ms: float = 250.0

    def clamp(self) -> "StreamParams":
        self.quality = max(1, min(100, int(self.quality)))
        self.dpr = max(0.1, min(8.0, float(self.dpr)))
        self.settle_scale = max(1.0, min(4.0, float(self.settle_scale)))
        self.settle_ms = max(0.0, min(5000.0, float(self.settle_ms)))
        self.max_fps = max(1.0, min(240.0, float(self.max_fps)))
        self.max_in_flight = max(1, min(16, int(self.max_in_flight)))
        self.ack_timeout_s = max(0.05, min(30.0, float(self.ack_timeout_s)))
        self.max_outbox = max(1, min(1024, int(self.max_outbox)))
        self.geometry_reps = normalise_reps(self.geometry_reps)
        if self.mask_mode not in MASK_MODES:
            raise BridgeError(
                "maskMode must be one of %s" % (", ".join(MASK_MODES),),
                maskMode=self.mask_mode,
            )
        self.coverage_scan_ms = max(0.0, min(10_000.0, float(self.coverage_scan_ms)))
        return self

    def to_payload(self, **extra: Any) -> Dict[str, Any]:
        """The ``pixels`` topic event body (``PixelsPayload``, WP-01)."""
        payload: Dict[str, Any] = {
            "dpr": self.dpr,
            "motionEncoding": self.motion_encoding,
            "settleEncoding": self.settle_encoding,
            "quality": self.quality,
            "paused": self.paused,
            "settleMs": self.settle_ms,
            "settleScale": self.settle_scale,
            "maxFps": self.max_fps,
            "maxInFlight": self.max_in_flight,
            # -- D2.  A client reads `geometryReps` back to confirm the bridge
            # understood the declaration, and `maskMode` to know whether the
            # bridge can actually stop drawing what it declared.
            "geometryReps": list(self.geometry_reps),
            "maskMode": self.mask_mode,
            "allowNoRaster": self.allow_no_raster,
            "perRepComposition": True,
        }
        payload.update(extra)
        return payload


# --------------------------------------------------------------------------- #
# The dirty gate
# --------------------------------------------------------------------------- #


class RedisplayGate:
    """The process's single consumer of ``PyMOL_GetRedisplay`` (destructive).

    See the module docstring for why this has to run *before* the draw.  Sinks
    registered with :meth:`add_sink` are called with ``(dirty: bool)`` once per
    tick on the engine thread; WP-03's ``redisplay`` topic is meant to hang off
    this rather than draining the flag a second time.
    """

    def __init__(self) -> None:
        self._sinks: List[Callable[[bool], None]] = []
        self._lock = threading.Lock()
        self._attached_to: Any = None
        self._original_tick: Optional[Callable[[], bool]] = None
        self.mode = "detached"
        #: Sticky: set by a probe or by :meth:`mark`, cleared by the consumer.
        self.pending = True  # the first frame is always owed
        self.probes = 0
        self.dirty_probes = 0
        self.external_marks = 0

    # -- attach / detach ---------------------------------------------------

    def attach(self, pump: Any) -> str:
        """Install the pre-draw probe.  Returns the mode actually used."""
        if self._attached_to is not None:
            return self.mode
        self._attached_to = pump
        adder = getattr(pump, "add_pre_tick_hook", None)
        if callable(adder):
            adder(self._probe)
            self.mode = "pre-tick-hook"
            return self.mode
        engine = pump.engine
        self._original_tick = engine.tick

        def tick() -> bool:
            self._probe(engine)
            return self._original_tick()  # type: ignore[misc]

        engine.tick = tick  # type: ignore[method-assign]
        self.mode = "engine-tick-wrapper"
        log(
            "RedisplayGate: pump has no add_pre_tick_hook, wrapping "
            "Engine.tick on the instance (PyMOL_Draw clears RedisplayFlag "
            "at layer5/PyMOL.cpp:2331, so a post-draw probe is always False)"
        )
        return self.mode

    def detach(self) -> None:
        pump, self._attached_to = self._attached_to, None
        if pump is None:
            return
        remover = getattr(pump, "remove_pre_tick_hook", None)
        if self.mode == "pre-tick-hook" and callable(remover):
            remover(self._probe)
        elif self._original_tick is not None:
            try:
                pump.engine.tick = self._original_tick  # type: ignore[method-assign]
            except Exception:  # noqa: BLE001
                pass
        self._original_tick = None
        self.mode = "detached"

    # -- the probe ---------------------------------------------------------

    def _probe(self, engine: Any) -> None:
        self.probes += 1
        dirty = False
        try:
            if engine.p is not None:
                dirty = bool(engine.p.getRedisplay(1))
        except Exception as exc:  # noqa: BLE001 - never take the pump down
            log("RedisplayGate probe raised %r" % (exc,))
            return
        if dirty:
            self.dirty_probes += 1
            self.pending = True
        with self._lock:
            sinks = list(self._sinks)
        for sink in sinks:
            try:
                sink(dirty)
            except Exception as exc:  # noqa: BLE001
                log("redisplay sink %r raised %r" % (sink, exc))

    # -- api ---------------------------------------------------------------

    def mark(self, reason: str = "") -> None:
        """Force the next tick to count as dirty (resize, ray, first frame)."""
        self.external_marks += 1
        self.pending = True

    def take(self) -> bool:
        """Consume the sticky dirty bit.  Only the frame producer may call it."""
        was = self.pending
        self.pending = False
        return was

    def add_sink(self, sink: Callable[[bool], None]) -> None:
        with self._lock:
            self._sinks.append(sink)

    def remove_sink(self, sink: Callable[[bool], None]) -> None:
        with self._lock:
            if sink in self._sinks:
                self._sinks.remove(sink)

    def stats(self) -> Dict[str, Any]:
        return {
            "mode": self.mode,
            "probes": self.probes,
            "dirtyProbes": self.dirty_probes,
            "externalMarks": self.external_marks,
            "pending": self.pending,
        }


# --------------------------------------------------------------------------- #
# glReadPixels
# --------------------------------------------------------------------------- #


class PixelReadback:
    """``glReadPixels`` against whatever offscreen backend is in play.

    Resolution order for the GL entry points, so the whole three-platform
    matrix works with one code path:

    1. ``ctx.gl`` — the ``GLFunctions`` table ``glcontext/egl.py`` and
       ``glcontext/wgl.py`` expose (spike 07);
    2. ``ctx._gl`` — the private ``CDLL`` ``glcontext/cgl.py`` already holds;
    3. a fresh ``ctypes.CDLL`` on the platform's GL library, as a last resort.

    Option 1 is what spike 07 asked WP-04 to prefer ("read back through
    ``ctx.gl.glReadPixels`` ... so Mode P shares one dispatch table with the
    context on all three platforms"); options 2 and 3 exist because
    ``CGLContext`` has no ``.gl`` yet.
    """

    _DARWIN_GL = "/System/Library/Frameworks/OpenGL.framework/Libraries/libGL.dylib"

    def __init__(self, context: Any) -> None:
        self.context = context
        self.source = "none"
        self._read_pixels: Optional[Callable[..., Any]] = None
        self._pixel_storei: Optional[Callable[..., Any]] = None
        self._read_buffer: Optional[Callable[..., Any]] = None
        self._buffer: Any = None
        self._buffer_bytes = 0
        self._resolve()

    # -- resolution --------------------------------------------------------

    def _resolve(self) -> None:
        ctx = self.context
        table = getattr(ctx, "gl", None)
        if table is not None and hasattr(table, "glReadPixels"):
            self._read_pixels = table.glReadPixels
            self._pixel_storei = getattr(table, "glPixelStorei", None)
            self._read_buffer = getattr(table, "glReadBuffer", None)
            self.source = "context.gl"
            return
        lib = getattr(ctx, "_gl", None)
        if lib is not None and hasattr(lib, "glReadPixels"):
            self._bind(lib, "context._gl")
            return
        lib = self._dlopen()
        if lib is not None:
            self._bind(lib, "dlopen")
            return
        raise NoOffscreenGL(
            "cannot resolve glReadPixels for backend %r"
            % (getattr(ctx, "backend", "?"),),
            platform=sys.platform,
            backend=getattr(ctx, "backend", "?"),
            reason="no-readpixels",
        )

    def _bind(self, lib: Any, source: str) -> None:
        self._read_pixels = lib.glReadPixels
        self._pixel_storei = getattr(lib, "glPixelStorei", None)
        self._read_buffer = getattr(lib, "glReadBuffer", None)
        self.source = source

    def _dlopen(self) -> Any:
        candidates: Sequence[str]
        if sys.platform == "darwin":
            candidates = (self._DARWIN_GL,)
        elif sys.platform.startswith("win"):
            candidates = ("opengl32.dll",)
        else:
            candidates = ("libGL.so.1", "libGL.so")
        for name in candidates:
            try:
                return ctypes.CDLL(name)
            except OSError:
                continue
        return None

    # -- the readback ------------------------------------------------------

    def buffer_for(self, width: int, height: int) -> Any:
        need = int(width) * int(height) * 4
        if self._buffer is None or self._buffer_bytes < need:
            self._buffer = (ctypes.c_ubyte * need)()
            self._buffer_bytes = need
        return self._buffer

    def read(self, width: int, height: int) -> Tuple[Any, float]:
        """Read ``width x height`` RGBA from the bound FBO.  Bottom-up.

        Returns ``(buffer, milliseconds)``.  The buffer is REUSED between calls
        — encode from it immediately, never retain it.
        """
        if self._read_pixels is None:  # pragma: no cover - _resolve raises
            raise NoOffscreenGL("glReadPixels unavailable", reason="no-readpixels")
        buf = self.buffer_for(width, height)
        t0 = time.perf_counter()
        if self._read_buffer is not None:
            try:
                self._read_buffer(_GL_COLOR_ATTACHMENT0)
            except Exception:  # noqa: BLE001 - default is already correct
                self._read_buffer = None
        if self._pixel_storei is not None:
            try:
                self._pixel_storei(_GL_PACK_ALIGNMENT, 4)
            except Exception:  # noqa: BLE001
                self._pixel_storei = None
        self._read_pixels(
            0, 0, int(width), int(height), _GL_RGBA, _GL_UNSIGNED_BYTE, buf
        )
        return buf, (time.perf_counter() - t0) * 1000.0

    def info(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "bufferBytes": self._buffer_bytes,
            "backend": getattr(self.context, "backend", None),
        }


# --------------------------------------------------------------------------- #
# One subscribed client
# --------------------------------------------------------------------------- #


@dataclass
class Subscriber:
    """Per-client flow-control state.  ``sink`` is duck-typed on purpose.

    The product's sink is :class:`tenmol_bridge.session.ClientSession` (it has
    ``send_soon`` and ``outbox``); the tests use a list-backed stub.  Anything
    with ``send_soon(frame_bytes)`` works.
    """

    key: Any
    sink: Any
    last_sent: int = 0
    last_acked: int = 0
    sent_at: float = 0.0
    frames_sent: int = 0
    frames_skipped: int = 0
    bytes_sent: int = 0
    ack_latency_ms: float = 0.0
    acks: int = 0
    ack_timeouts: int = 0

    # -- flow control ------------------------------------------------------

    def in_flight(self) -> int:
        return max(0, self.last_sent - self.last_acked)

    def outbox_depth(self) -> int:
        outbox = getattr(self.sink, "outbox", None)
        if outbox is not None:
            try:
                return int(outbox.qsize())
            except Exception:  # noqa: BLE001
                return 0
        depth = getattr(self.sink, "queued", None)
        if callable(depth):
            try:
                return int(depth())
            except Exception:  # noqa: BLE001
                return 0
        return 0

    def blocked(self, params: StreamParams, now: float) -> Optional[str]:
        """``None`` when a frame may be sent, else why it may not."""
        if self.outbox_depth() > params.max_outbox:
            return "outbox"
        flight = self.in_flight()
        if flight < params.max_in_flight:
            return None
        if self.sent_at and (now - self.sent_at) >= params.ack_timeout_s:
            # The client is not acking (or the ack was lost).  Liveness beats
            # flow control: release the window, count it, keep going.
            self.ack_timeouts += 1
            self.last_acked = self.last_sent
            return None
        return "unacked"

    def ack(self, frame_id: int, now: Optional[float] = None) -> bool:
        frame_id = int(frame_id)
        if frame_id <= self.last_acked or frame_id > self.last_sent:
            return False
        self.last_acked = frame_id
        self.acks += 1
        if self.sent_at:
            self.ack_latency_ms = ((now or time.monotonic()) - self.sent_at) * 1000.0
        return True

    def record_sent(self, frame_id: int, nbytes: int, now: float) -> None:
        self.last_sent = frame_id
        self.sent_at = now
        self.frames_sent += 1
        self.bytes_sent += nbytes

    def stats(self) -> Dict[str, Any]:
        return {
            "framesSent": self.frames_sent,
            "framesSkipped": self.frames_skipped,
            "bytesSent": self.bytes_sent,
            "lastSent": self.last_sent,
            "lastAcked": self.last_acked,
            "acks": self.acks,
            "ackTimeouts": self.ack_timeouts,
            "ackLatencyMs": round(self.ack_latency_ms, 2),
        }


# --------------------------------------------------------------------------- #
# The frame header
# --------------------------------------------------------------------------- #


def pixel_frame_header(
    image: EncodedImage,
    frame_id: int,
    seq: int,
    dpr: float,
    view: Optional[Sequence[float]] = None,
    reps: Optional[Sequence[int]] = None,
    still: Optional[str] = None,
) -> Dict[str, Any]:
    """``PixelFrameHeader`` from ``packages/protocol/src/geometry.ts``.

    Byte-for-byte the shape ``packages/protocol/python/tenmol_wire.py``'s
    :func:`pixel_header` produces (``test_render.py`` asserts it), with two
    additive keys the TypeScript interface tolerates: ``still`` names the reason
    a lossless frame was sent (``settle`` / ``ray`` / ``requested``) and
    ``encodeMs`` carries the server-side cost for the client's HUD.
    """
    header: Dict[str, Any] = {
        "v": 1,
        "kind": "pixels",
        "seq": int(seq),
        "payloadBytes": len(image.data),
        "width": int(image.width),
        "height": int(image.height),
        "dpr": float(dpr),
        "encoding": image.encoding,
        "flipY": bool(image.flip_y),
        "lossless": bool(image.lossless),
        "frameId": int(frame_id),
        "encodeMs": round(image.encode_ms, 3),
    }
    if image.quality is not None:
        header["quality"] = int(image.quality)
    if view is not None:
        header["view"] = [float(v) for v in view]
    if reps is not None:
        header["reps"] = [int(r) for r in reps]
    if still is not None:
        header["still"] = still
    return header


# --------------------------------------------------------------------------- #
# The stream
# --------------------------------------------------------------------------- #


class FrameStream:
    """Readback + encode + fan-out, driven by the pump's tick hook."""

    def __init__(
        self,
        pump: Any,
        params: Optional[StreamParams] = None,
        gate: Optional[RedisplayGate] = None,
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    ) -> None:
        self.pump = pump
        self.params = (params or StreamParams()).clamp()
        self.gate = gate or RedisplayGate()
        self.on_event = on_event
        self.quality = AdaptiveQuality(base=self.params.quality)

        self._subs: Dict[Any, Subscriber] = {}
        self._lock = threading.Lock()
        self._readback: Optional[PixelReadback] = None
        self._attached = False

        self._frame_id = 0
        self._seq = 0
        self._forced = 0
        #: "a frame is owed" — set by the rate cap, by backpressure and by a
        #: pause.  DELIBERATELY NOT the same thing as ``gate.pending``, which
        #: means "the scene changed": conflating them makes every skipped frame
        #: look like motion, which resets the settle timer and produces an
        #: endless dribble of JPEGs on a static scene (measured before the
        #: split: 2 spurious frames per idle second).
        self._owed = False
        self._last_emit = 0.0
        self._last_dirty = 0.0
        self._settle_sent = True
        self._resize_pending: Optional[Tuple[int, int]] = None

        # -- defect D2: composition ---------------------------------------
        self.coverage = CoverageProbe()
        #: The plan the LAST frame was rendered with.  Read by ``describe()``
        #: and ``stats()``, which run on the asyncio thread, so it is only ever
        #: rebound (never mutated) and ``MaskPlan`` is frozen.
        self._plan = MaskPlan()
        #: The declaration ``self._plan`` was computed against, so a change of
        #: mind by the client re-plans immediately instead of at the next scan.
        self._planned_for: Tuple[Any, ...] = ()
        #: One background-only frame is owed whenever the stream stops
        #: rasterising, so the client has something correct under its Mode-G
        #: canvas instead of the last stale bitmap.
        self._blank_sent = False
        self.masked_frames = 0
        self.blank_frames = 0
        self.mask_ms = 0.0
        self.raster_skipped = 0

        # -- telemetry (all milliseconds unless named otherwise)
        self.frames_emitted = 0
        self.stills_emitted = 0
        self.frames_skipped = 0
        self.ticks_seen = 0
        self.ticks_dirty = 0
        self.bytes_emitted = 0
        self.last_readback_ms = 0.0
        self.last_encode_ms = 0.0
        self.last_total_ms = 0.0
        self.last_bytes = 0
        self.last_error: Optional[str] = None
        self.render_failures = 0
        #: Quiet period after a render error, so a persistently broken frame
        #: does not become a 60 Hz busy loop of tracebacks.
        self.error_backoff_s = 1.0
        self._error_until = 0.0
        self._samples: List[Tuple[float, float, float, int]] = []
        self._max_samples = 512

    # -- lifecycle ---------------------------------------------------------

    def attach(self) -> "FrameStream":
        """Register the pre-draw dirty probe and the post-draw frame hook."""
        if self._attached:
            return self
        self.gate.attach(self.pump)
        self.pump.add_tick_hook(self.on_tick)
        self._attached = True
        return self

    def detach(self) -> None:
        if not self._attached:
            return
        try:
            self.pump.remove_tick_hook(self.on_tick)
        finally:
            self.gate.detach()
            self._attached = False

    def __enter__(self) -> "FrameStream":
        return self.attach()

    def __exit__(self, *exc: Any) -> None:
        self.detach()

    # -- clients -----------------------------------------------------------

    def add_client(self, sink: Any, key: Any = None) -> Subscriber:
        """Subscribe ``sink``.  Idempotent per key."""
        key = key if key is not None else id(sink)
        with self._lock:
            sub = self._subs.get(key)
            if sub is None:
                sub = Subscriber(key=key, sink=sink)
                self._subs[key] = sub
        # A new client owes a frame immediately: it has nothing to show.
        self.request_frame()
        return sub

    def remove_client(self, key_or_sink: Any) -> None:
        with self._lock:
            if key_or_sink in self._subs:
                del self._subs[key_or_sink]
                return
            for key, sub in list(self._subs.items()):
                if sub.sink is key_or_sink:
                    del self._subs[key]
                    return

    def subscriber(self, key_or_sink: Any) -> Optional[Subscriber]:
        with self._lock:
            sub = self._subs.get(key_or_sink)
            if sub is not None:
                return sub
            for candidate in self._subs.values():
                if candidate.sink is key_or_sink:
                    return candidate
        return None

    @property
    def client_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def ack(self, key_or_sink: Any, frame_id: int) -> bool:
        """``{t:'ack', what:'pixels', frameId}`` from a client."""
        sub = self.subscriber(key_or_sink)
        if sub is None:
            return False
        return sub.ack(frame_id)

    # -- control -----------------------------------------------------------

    def request_frame(self, count: int = 1) -> None:
        """Emit on the next tick even if nothing is dirty."""
        self._forced = max(self._forced, int(count))

    def set_params(self, **changes: Any) -> Dict[str, Any]:
        """Apply a ``PixelStreamRequest``.  Returns the new ``PixelsPayload``."""
        params = self.params
        alias = {
            "motionEncoding": "motion_encoding",
            "settleEncoding": "settle_encoding",
            "settleMs": "settle_ms",
            "settleScale": "settle_scale",
            "maxFps": "max_fps",
            "maxInFlight": "max_in_flight",
            "ackTimeout": "ack_timeout_s",
            "serverFlip": "server_flip",
            # -- D2.  `geometryReps` is the client saying "I am drawing these
            # myself".  It rides the EXISTING `_bridge.set_pixel_stream` route,
            # deliberately: a new route would need the dispatcher to grow a
            # session-threading it does not have yet (the same gap D4 has).
            "geometryReps": "geometry_reps",
            "maskMode": "mask_mode",
            "allowNoRaster": "allow_no_raster",
            "coverageScanMs": "coverage_scan_ms",
        }
        resize: Optional[Tuple[int, int]] = None
        width = changes.pop("width", None)
        height = changes.pop("height", None)
        if width or height:
            current = self.viewport()
            resize = (int(width or current[0]), int(height or current[1]))
        for name, value in changes.items():
            field_name = alias.get(name, name)
            if not hasattr(params, field_name):
                raise BridgeError(
                    "unknown pixel stream parameter %r" % (name,), parameter=name
                )
            setattr(params, field_name, value)
        for enc_attr in ("motion_encoding", "settle_encoding"):
            requested = getattr(params, enc_attr)
            setattr(
                params,
                enc_attr,
                _encode.resolve_encoding(
                    requested, prefer_lossless=enc_attr == "settle_encoding"
                ),
            )
        params.clamp()
        self.quality.set_base(params.quality)
        if resize is not None:
            self._resize_pending = resize
        # A new declaration invalidates the plan and, if the stream had stopped
        # rasterising, re-owes the background frame.
        self._planned_for = ()
        self._blank_sent = False
        self.gate.mark("set_params")
        self.request_frame()
        return self.describe()

    def viewport(self) -> Tuple[int, int]:
        engine = self.pump.engine
        return int(engine.width), int(engine.height)

    def describe(self) -> Dict[str, Any]:
        width, height = self.viewport()
        blocked = 0
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            if sub.in_flight() >= self.params.max_in_flight:
                blocked += 1
        plan = self._plan
        return self.params.to_payload(
            width=width,
            height=height,
            frameId=self._frame_id,
            awaitingAck=blocked > 0,
            clients=len(subs),
            effectiveQuality=self.quality.quality,
            # `reps` here is the LAST PLANNED bitmap content, not a promise
            # about the next frame: `describe()` is answered on the asyncio
            # thread and may not touch PyMOL.  The authority is always
            # `PixelFrameHeader.reps` on the frame itself.
            reps=[] if plan.reps is None else list(plan.reps),
            repsKnown=plan.reps is not None,
            maskedObjects=list(plan.masked),
            rasterizing=plan.raster,
            maskReason=plan.reason,
        )

    # -- the tick ----------------------------------------------------------

    def on_tick(self, engine: Any) -> None:
        """Post-draw hook.  Runs on the engine thread; must stay cheap."""
        self.ticks_seen += 1
        dirty = self.gate.take()
        if dirty:
            self.ticks_dirty += 1
            self._last_dirty = time.monotonic()
            self._settle_sent = False

        if self._resize_pending is not None:
            width, height = self._resize_pending
            self._resize_pending = None
            try:
                engine.resize(width, height)
                engine.p.draw()
                self.gate.mark("resize")
                self._emit_event(self.describe())
            except Exception as exc:  # noqa: BLE001
                self.last_error = "resize: %r" % (exc,)
                log("FrameStream resize failed: %r" % (exc,))
            dirty = True
            self._settle_sent = False

        if self.params.paused or not self._subs:
            # Nobody consumed the frame that dirty bit stood for, so the first
            # frame after unpause must still be a real one.
            if dirty:
                self._owed = True
            return
        if engine.context is None or engine.cmd is None:
            if dirty:
                self._owed = True
            return

        now = time.monotonic()
        if now < self._error_until:
            if dirty:
                self._owed = True
            return
        # -- D2: what is this frame supposed to contain? --------------------
        # Before the rate cap and before the settle logic, because a plan that
        # flips to "nothing to rasterise" owes the client one background frame
        # and a plan that flips back owes it a real one.
        plan = self._refresh_plan(engine, dirty=dirty, now=now)
        forced = self._forced > 0
        owed = self._owed or forced
        quiet = (now - self._last_dirty) * 1000.0 >= self.params.settle_ms

        if not plan.raster and self._blank_sent and not forced:
            # Every rep in the scene is being drawn by the client.  No draw, no
            # glReadPixels, no encode — this is the GL-free state.  A dirty bit
            # here belongs to geometry the client is fetching for itself, so it
            # does NOT leave a pixel frame owed.
            self.raster_skipped += 1
            self._owed = False
            self._settle_sent = True
            return

        if not dirty and not owed:
            # Quiescent.  One lossless still, then nothing at all until
            # something changes: "never spin at full rate on a static scene".
            if not self._settle_sent and self.frames_emitted > 0 and quiet:
                if self._emit(engine, still="settle") is not None:
                    self._settle_sent = True
            return

        if not forced and (now - self._last_emit) < 1.0 / self.params.max_fps:
            # Rate cap.  We still OWE this frame — dropping it here would leave
            # the client showing a stale picture forever — but it is not fresh
            # motion, so the settle timer keeps running.
            self._owed = True
            return

        if self._forced > 0:
            self._forced -= 1
        # A frame we owe on a scene that has already gone quiet may as well be
        # the lossless one; a frame we owe mid-drag must be cheap.
        still = "settle" if (not dirty and quiet and not self._settle_sent) else None
        if still is None and not dirty and quiet:
            still = "requested"
        self._owed = False
        if self._emit(engine, still=still) is not None and still is not None:
            self._settle_sent = True

    # -- D2: the plan and the mask -----------------------------------------

    def _refresh_plan(self, engine: Any, dirty: bool, now: float) -> MaskPlan:
        """Recompute :attr:`_plan` when it could have changed.  Engine thread.

        Cost discipline, in order of how often each case fires:

        * client declared nothing (today's default, and every Mode-P-only
          client): **zero** PyMOL calls, forever;
        * declared, scene static: zero — the probe only runs on a dirty tick;
        * declared, scene moving: one probe per ``coverage_scan_ms``.
        """
        params = self.params
        signature = (params.geometry_reps, params.mask_mode, params.allow_no_raster)
        changed_declaration = signature != self._planned_for
        if not params.geometry_reps:
            if changed_declaration:
                self._planned_for = signature
                self._plan = plan_mask(self.coverage.last, (), params.mask_mode)
                self._blank_sent = False
            return self._plan
        if not (
            changed_declaration
            or (dirty and self.coverage.stale(now, params.coverage_scan_ms))
        ):
            return self._plan

        self._planned_for = signature
        coverage = self.coverage.probe(engine)
        plan = plan_mask(
            coverage,
            params.geometry_reps,
            mask_mode=params.mask_mode,
            allow_no_raster=params.allow_no_raster,
        )
        previous = self._plan
        self._plan = plan
        if plan.raster != previous.raster or plan.reps != previous.reps:
            # The client's compositing rule just changed.  Owe it a frame: on
            # the way down that is the one background-only bitmap it will ever
            # get, on the way up it is the first bitmap containing the rep it
            # must stop drawing.
            self._blank_sent = False
            self.request_frame()
            self.gate.mark("mask-plan")
            self._emit_event(self.describe())
            log(
                "pixel mask: rasterizing=%s reps=%s masked=%s (%s)"
                % (plan.raster, plan.reps, plan.masked, plan.reason)
            )
        return plan

    @contextlib.contextmanager
    def _masked(self, engine: Any, names: Sequence[str]) -> Iterator[bool]:
        """Disable ``names``, yield, enable them again.  Engine thread only.

        Everything between the two halves runs on this thread with no chance to
        yield to a client command, so the mask is never observable.  The
        ``finally`` is unconditional: an exception in the readback must not
        leave the user's objects switched off.
        """
        cmd = getattr(engine, "cmd", None)
        if not names or cmd is None:
            yield False
            return
        t0 = time.perf_counter()
        disabled: List[str] = []
        try:
            for name in names:
                cmd.disable(name)
                disabled.append(name)
            engine.p.draw()
            self.masked_frames += 1
            self.mask_ms += (time.perf_counter() - t0) * 1000.0
            yield True
        finally:
            t1 = time.perf_counter()
            for name in reversed(disabled):
                try:
                    cmd.enable(name)
                except Exception as exc:  # noqa: BLE001 - keep going, log loud
                    log(
                        "FrameStream could not re-enable %r after a masked "
                        "frame: %r — the user's scene may be missing an object"
                        % (name, exc)
                    )
            try:
                # `disable`/`enable` dirtied PyMOL; that dirt is ours and the
                # frame we just produced already accounts for it.  Nothing else
                # can have run in this window, so swallowing it here cannot eat
                # a user change.
                engine.p.getRedisplay(1)
            except Exception:  # noqa: BLE001
                pass
            # Only the mask's own two halves; the readback happened in the
            # `yield` and is accounted for by `last_readback_ms`.
            self.mask_ms += (time.perf_counter() - t1) * 1000.0

    # -- emission ----------------------------------------------------------

    def _ready_subscribers(self, now: float) -> Tuple[List[Subscriber], int]:
        ready: List[Subscriber] = []
        blocked = 0
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            reason = sub.blocked(self.params, now)
            if reason is None:
                ready.append(sub)
            else:
                blocked += 1
                sub.frames_skipped += 1
        return ready, blocked

    def _emit(self, engine: Any, still: Optional[str] = None) -> Optional[int]:
        now = time.monotonic()
        ready, blocked = self._ready_subscribers(now)
        if not ready:
            # Everyone is behind.  Drop the frame (never queue it), remember we
            # still owe one, and make the next one cheaper.
            self.frames_skipped += 1
            self.quality.observe(0.0, skipped=True)
            self._owed = True
            return None

        lossless = still is not None
        encoding = (
            self.params.settle_encoding if lossless else self.params.motion_encoding
        )
        t0 = time.perf_counter()
        try:
            image = self._render_frame(engine, encoding, lossless=lossless)
        except Exception as exc:  # noqa: BLE001 - a broken frame must not kill the pump
            self.last_error = repr(exc)
            self.render_failures += 1
            # Back off rather than retrying a failing render 60 times a second.
            self._error_until = now + self.error_backoff_s
            log("FrameStream: frame dropped: %r" % (exc,))
            return None
        total_ms = (time.perf_counter() - t0) * 1000.0

        self._frame_id += 1
        self._seq += 1
        plan = self._plan
        header = pixel_frame_header(
            image,
            frame_id=self._frame_id,
            seq=self._seq,
            dpr=self.params.dpr,
            view=self._safe_view(engine),
            # THE D2 CONTRACT.  `reps` is what is IN this bitmap; the client
            # draws in Mode G exactly what is not listed.  `None` keeps the key
            # out of the header entirely, which the protocol reads as "the
            # whole scene" — the correct answer when nothing was declared.
            reps=plan.reps,
            still=still,
        )
        if plan.masked:
            header["maskedObjects"] = list(plan.masked)
        frame = encode_binary_frame(header, image.data)
        if not plan.raster:
            self._blank_sent = True
            self.blank_frames += 1

        for sub in ready:
            try:
                sub.sink.send_soon(frame)
            except Exception as exc:  # noqa: BLE001
                log("pixel sink %r raised %r" % (sub.key, exc))
                continue
            sub.record_sent(self._frame_id, len(frame), now)

        self.frames_emitted += 1
        if lossless:
            self.stills_emitted += 1
        self.bytes_emitted += len(frame)
        self.last_encode_ms = image.encode_ms
        self.last_total_ms = total_ms
        self.last_bytes = len(frame)
        self._last_emit = now
        if not lossless:
            self.quality.observe(image.encode_ms, skipped=blocked > 0)
        self._samples.append(
            (self.last_readback_ms, image.encode_ms, total_ms, len(frame))
        )
        if len(self._samples) > self._max_samples:
            del self._samples[: len(self._samples) - self._max_samples]
        return self._frame_id

    def _render_frame(
        self, engine: Any, encoding: str, lossless: bool
    ) -> EncodedImage:
        """Read the FBO back and encode it.  Engine thread only."""
        if self._readback is None:
            self._readback = PixelReadback(engine.context)
        scale = self.params.settle_scale if lossless else 1.0
        if scale > 1.0:
            return self._render_scaled_still(engine, encoding, scale)
        width, height = self.viewport()
        # D2: disable -> draw -> read -> enable.  With nothing to mask this is
        # the bare readback it has always been; `_masked` short-circuits.
        with self._masked(engine, self._plan.masked):
            buf, read_ms = self._readback.read(width, height)
        self.last_readback_ms = read_ms
        return _encode.encode_rgba(
            buf,
            width,
            height,
            encoding=encoding,
            quality=self.quality.quality,
            bottom_up=True,
            flip=self.params.server_flip,
            alpha=self.params.alpha,
        )

    def _render_scaled_still(
        self, engine: Any, encoding: str, scale: float
    ) -> EncodedImage:
        """Settle at ``dpr``: resize the FBO up, draw, read, resize back.

        13.9 ms/frame at 2560x1920 is fine for a still and not for a drag, which
        is exactly why this only ever runs on the settle path (plan §1.3).
        """
        base_w, base_h = self.viewport()
        big_w, big_h = int(base_w * scale), int(base_h * scale)
        try:
            engine.resize(big_w, big_h)
            engine.p.draw()
            assert self._readback is not None
            with self._masked(engine, self._plan.masked):
                buf, read_ms = self._readback.read(big_w, big_h)
            self.last_readback_ms = read_ms
            return _encode.encode_rgba(
                buf,
                big_w,
                big_h,
                encoding=encoding,
                quality=self.quality.quality,
                bottom_up=True,
                flip=self.params.server_flip,
                alpha=self.params.alpha,
            )
        finally:
            try:
                engine.resize(base_w, base_h)
                engine.p.draw()
                # The resize dirtied PyMOL again; swallow that so the settle
                # still does not immediately re-trigger itself.
                engine.p.getRedisplay(1)
                self.gate.pending = False
            except Exception as exc:  # noqa: BLE001
                self.last_error = "restore-size: %r" % (exc,)
                log("FrameStream could not restore the viewport: %r" % (exc,))

    @staticmethod
    def _safe_view(engine: Any) -> Optional[List[float]]:
        try:
            return [float(v) for v in engine.cmd.get_view()]
        except Exception:  # noqa: BLE001
            return None

    def _emit_event(self, payload: Dict[str, Any]) -> None:
        if self.on_event is not None:
            try:
                self.on_event(TOPIC_PIXELS, payload)
            except Exception as exc:  # noqa: BLE001
                log("pixels event sink raised %r" % (exc,))

    # -- ray ---------------------------------------------------------------

    def ray_now(
        self,
        engine: Any,
        width: int = 0,
        height: int = 0,
        antialias: int = -1,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """``cmd.ray`` as an explicit high-quality mode.  Engine thread only.

        ``cmd.ray()`` leaves the result in the scene's image buffer, and
        ``cmd.png(None, prior=1)`` returns *those exact bytes* as a PNG without
        re-rendering: ``CmdPNG`` returns ``PyBytes_FromStringAndSize(pngbuf)``
        whenever the filename is empty (``layer4/Cmd.cpp:4830-4834``), and
        ``prior=1`` takes the fast path that never touches
        ``_call_with_opengl_context`` (``modules/pymol/exporting.py:588-593``).
        That matters: the plain ``cmd.png(None)`` path needs WP-02's
        ``_pushValidContext`` shim and raises "getting png buffer failed"
        without it — measured.
        """
        cmd = engine.cmd
        if cmd is None:
            raise PyMOLUnavailable("cannot ray: PyMOL is not available")
        t0 = time.perf_counter()
        cmd.ray(int(width), int(height), int(antialias), quiet=1, **kwargs)
        ray_ms = (time.perf_counter() - t0) * 1000.0
        data = cmd.png(None, prior=1, quiet=1)
        if not isinstance(data, (bytes, bytearray)):
            raise BridgeError(
                "cmd.png(None, prior=1) returned %r, not PNG bytes"
                % (type(data).__name__,)
            )
        png_ms = (time.perf_counter() - t0) * 1000.0 - ray_ms
        image = EncodedImage(
            data=bytes(data),
            encoding="png",
            width=int(width) or self.viewport()[0],
            height=int(height) or self.viewport()[1],
            flip_y=False,  # ScenePNG writes top-down, unlike glReadPixels
            quality=None,
            encode_ms=png_ms,
        )
        # `cmd.ray` traverses the scene itself; the transient mask lives only
        # inside `_render_frame`, so a ray is ALWAYS the full scene however
        # much of it the client is drawing.  Say so in the header, or the
        # client composites its Mode-G copy on top of a ray that already
        # contains it — the very double draw D2 is about.
        frame_id = self._push_still(
            image, still="ray", reps=self._plan.visible or None
        )
        # PyMOL keeps showing the ray image until the scene changes, exactly as
        # the desktop does, so the next readback would just be the same picture.
        self._settle_sent = True
        return {
            "frameId": frame_id,
            "bytes": len(image.data),
            "width": image.width,
            "height": image.height,
            "rayMs": round(ray_ms, 3),
            "pngMs": round(png_ms, 3),
        }

    def ray(self, width: int = 0, height: int = 0, **kwargs: Any) -> Any:
        """Non-blocking :meth:`ray_now`; returns the pump's ``Future``."""
        return self.pump.submit(
            lambda engine: self.ray_now(engine, width, height, **kwargs),
            label="render:ray",
        )

    def _push_still(
        self,
        image: EncodedImage,
        still: str,
        reps: Optional[Sequence[int]] = None,
    ) -> int:
        now = time.monotonic()
        self._frame_id += 1
        self._seq += 1
        header = pixel_frame_header(
            image,
            frame_id=self._frame_id,
            seq=self._seq,
            dpr=self.params.dpr,
            reps=reps,
            still=still,
        )
        frame = encode_binary_frame(header, image.data)
        with self._lock:
            subs = list(self._subs.values())
        for sub in subs:
            try:
                sub.sink.send_soon(frame)
            except Exception as exc:  # noqa: BLE001
                log("pixel sink %r raised %r" % (sub.key, exc))
                continue
            sub.record_sent(self._frame_id, len(frame), now)
        self.frames_emitted += 1
        self.stills_emitted += 1
        self.bytes_emitted += len(frame)
        self.last_bytes = len(frame)
        self._last_emit = now
        return self._frame_id

    # -- telemetry ---------------------------------------------------------

    def timings(self) -> Dict[str, Any]:
        """Median / p95 of the last :attr:`_max_samples` emitted frames."""
        if not self._samples:
            return {"samples": 0}
        read = sorted(s[0] for s in self._samples)
        enc = sorted(s[1] for s in self._samples)
        total = sorted(s[2] for s in self._samples)
        size = sorted(s[3] for s in self._samples)

        def pick(values: List[float], q: float) -> float:
            return values[min(len(values) - 1, int(len(values) * q))]

        return {
            "samples": len(self._samples),
            "readbackMsMedian": round(pick(read, 0.5), 3),
            "encodeMsMedian": round(pick(enc, 0.5), 3),
            "frameMsMedian": round(pick(total, 0.5), 3),
            "frameMsP95": round(pick(total, 0.95), 3),
            "kbMedian": round(pick(size, 0.5) / 1024.0, 1),
            "kbP95": round(pick(size, 0.95) / 1024.0, 1),
        }

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            subs = {str(key): sub.stats() for key, sub in self._subs.items()}
        return {
            "attached": self._attached,
            "clients": len(subs),
            "framesEmitted": self.frames_emitted,
            "stills": self.stills_emitted,
            "framesSkipped": self.frames_skipped,
            "ticksSeen": self.ticks_seen,
            "ticksDirty": self.ticks_dirty,
            "bytesEmitted": self.bytes_emitted,
            "renderFailures": self.render_failures,
            "owed": self._owed,
            "lastError": self.last_error,
            # -- defect D2 ------------------------------------------------
            "mask": dict(
                self._plan.to_json(),
                maskedFrames=self.masked_frames,
                blankFrames=self.blank_frames,
                # Ticks on which the whole readback+encode+GL path was skipped
                # because the client is drawing the entire scene itself.  This
                # is the GL-free counter.
                rasterSkipped=self.raster_skipped,
                maskMsTotal=round(self.mask_ms, 3),
                blankSent=self._blank_sent,
            ),
            "coverage": self.coverage.stats(),
            "gate": self.gate.stats(),
            "quality": self.quality.stats(),
            "encoder": _encode.capabilities(),
            "readback": self._readback.info() if self._readback else None,
            "params": self.params.to_payload(),
            "timings": self.timings(),
            "subscribers": subs,
            "headerAlignment": HEADER_ALIGNMENT,
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<FrameStream %s>" % json.dumps(
            {
                "clients": self.client_count,
                "frames": self.frames_emitted,
                "skipped": self.frames_skipped,
            }
        )
