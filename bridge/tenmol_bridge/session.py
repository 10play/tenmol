"""Protocol v1 vocabulary and one connected client.

The wire strings here are the Python mirror of ``packages/protocol`` (WP-01).
They are frozen: adding a message type or a topic is a protocol change agreed
with the TypeScript side, not a local edit.

Transport: one WebSocket at ``ws://127.0.0.1:<port>/ws``.

* JSON text frames for control / RPC / events.
* Binary frames (server -> client) for bulk payloads::

      | uint32 LE header length | UTF-8 JSON metadata (space padded) | bytes |

  The header is padded so ``4 + header_length`` is a multiple of
  :data:`HEADER_ALIGNMENT`, which keeps the payload 4-byte aligned and lets the
  TypeScript decoder return a zero-copy ``Float32Array`` view instead of
  memcpy-ing every buffer.  Do not regress this: object names ``a``/``ab``/
  ``abc`` were measured putting the payload at byte 237/238/239.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import struct
from typing import Any, Dict, Iterable, Mapping, Optional, Set, Tuple

from .config import log
from .errors import BadMessage, error_payload

__all__ = [
    "PROTOCOL_VERSION",
    "T_CALL",
    "T_DO",
    "T_INPUT",
    "T_SUB",
    "T_UNSUB",
    "T_CONFIRM",
    "T_PING",
    "T_OK",
    "T_ERR",
    "T_EVENT",
    "T_FEEDBACK",
    "T_HELLO",
    "T_PONG",
    "CLIENT_MESSAGE_TYPES",
    "SERVER_MESSAGE_TYPES",
    "TOPICS",
    "validate_topic",
    "UnknownTopic",
    "Subscriptions",
    "hello_frame",
    "ok_frame",
    "err_frame",
    "event_frame",
    "feedback_frame",
    "progress_payload",
    "TK_DIALOG_KIND",
    "plugin_dialog_payload",
    "encode_binary_frame",
    "decode_binary_frame",
    "HEADER_ALIGNMENT",
    "ClientSession",
]

PROTOCOL_VERSION = 1

# -- message type tags ------------------------------------------------------

# client -> server
T_CALL = "call"
T_DO = "do"
T_INPUT = "input"
T_SUB = "sub"
T_UNSUB = "unsub"
T_CONFIRM = "confirm"
T_PING = "ping"

CLIENT_MESSAGE_TYPES = frozenset(
    {T_CALL, T_DO, T_INPUT, T_SUB, T_UNSUB, T_CONFIRM, T_PING}
)

# server -> client
T_OK = "ok"
T_ERR = "err"
T_EVENT = "event"
T_FEEDBACK = "feedback"
T_HELLO = "hello"
T_PONG = "pong"

SERVER_MESSAGE_TYPES = frozenset({T_OK, T_ERR, T_EVENT, T_FEEDBACK, T_HELLO, T_PONG})

# -- input kinds (WP-10 owns the semantics; the vocabulary is frozen here) ---

INPUT_BUTTON = "button"
INPUT_DRAG = "drag"
INPUT_RESHAPE = "reshape"
INPUT_KEY = "key"
INPUT_SCROLL = "scroll"

INPUT_KINDS = frozenset(
    {INPUT_BUTTON, INPUT_DRAG, INPUT_RESHAPE, INPUT_KEY, INPUT_SCROLL}
)

# -- topics -----------------------------------------------------------------
#
# The frozen v1 set, one owner each (plan §5.2 / §6).  Written once, here.

TOPIC_FEEDBACK = "feedback"  # WP-03
TOPIC_PROGRESS = "progress"  # WP-03
TOPIC_REDISPLAY = "redisplay"  # WP-03
TOPIC_PIXELS = "pixels"  # WP-04
TOPIC_VIEW = "view"  # WP-09
TOPIC_SELECTION = "selection"  # WP-10
TOPIC_OBJECTS = "objects"  # WP-12
TOPIC_MENU = "menu"  # WP-13
TOPIC_SETTINGS = "settings"  # WP-15
TOPIC_WIZARD = "wizard"  # WP-16
TOPIC_EDITOR = "editor"  # WP-17
TOPIC_DIALOG = "dialog"  # WP-18
TOPIC_FRAME = "frame"  # WP-20
TOPIC_SCENES = "scenes"  # WP-20
TOPIC_MOVIE_PANEL = "movie_panel"  # WP-20
TOPIC_SEQVIEW = "seqview"  # WP-21
TOPIC_COLORS = "colors"  # WP-22
TOPIC_PLUGIN = "plugin"  # WP-25
TOPIC_GEOMETRY = "geometry"  # WP-26 (Mode G)

TOPICS: frozenset = frozenset(
    {
        TOPIC_FEEDBACK,
        TOPIC_PROGRESS,
        TOPIC_REDISPLAY,
        TOPIC_PIXELS,
        TOPIC_VIEW,
        TOPIC_SELECTION,
        TOPIC_OBJECTS,
        TOPIC_MENU,
        TOPIC_SETTINGS,
        TOPIC_WIZARD,
        TOPIC_EDITOR,
        TOPIC_DIALOG,
        TOPIC_FRAME,
        TOPIC_SCENES,
        TOPIC_MOVIE_PANEL,
        TOPIC_SEQVIEW,
        TOPIC_COLORS,
        TOPIC_PLUGIN,
        TOPIC_GEOMETRY,
    }
)


class UnknownTopic(BadMessage):
    def __init__(self, topic: Any) -> None:
        super().__init__(
            "unknown topic %r; v1 topics are: %s"
            % (topic, ", ".join(sorted(TOPICS))),
            topic=topic,
        )
        self.topic = topic


def validate_topic(topic: Any) -> str:
    if not isinstance(topic, str) or topic not in TOPICS:
        raise UnknownTopic(topic)
    return topic


# -- frame builders ---------------------------------------------------------


def hello_frame(**fields: Any) -> Dict[str, Any]:
    frame = {"t": T_HELLO, "protocolVersion": PROTOCOL_VERSION}
    frame.update(fields)
    return frame


def ok_frame(msg_id: Optional[int], result: Any, **extra: Any) -> Dict[str, Any]:
    frame: Dict[str, Any] = {"id": msg_id, "t": T_OK, "result": result}
    frame.update(extra)
    return frame


def err_frame(msg_id: Optional[int], error: Mapping[str, Any]) -> Dict[str, Any]:
    return {"id": msg_id, "t": T_ERR, "error": dict(error)}


def err_frame_from_exception(
    msg_id: Optional[int], exc: BaseException
) -> Dict[str, Any]:
    return err_frame(msg_id, error_payload(exc))


def event_frame(topic: str, seq: int, payload: Any) -> Dict[str, Any]:
    return {"t": T_EVENT, "topic": topic, "seq": seq, "payload": payload}


def feedback_frame(lines: Iterable[Any]) -> Dict[str, Any]:
    return {"t": T_FEEDBACK, "lines": list(lines)}


def progress_payload(progress: float) -> Dict[str, Any]:
    """The ``progress`` topic payload.  Mirror of ``topics/progress.ts``.

    THIS USED TO DISAGREE WITH THE DECLARED TYPE IN EVERY FIELD.  The server
    emitted ``{"value": <float>}`` while ``ProgressPayload`` declared
    ``{fraction, busy, label, abortable}`` — zero overlap, so a consumer that
    trusted the type read ``undefined`` and the bar never moved.  (It worked
    only because ``apps/web/src/app/session.ts`` read both names defensively
    and said so in a comment.)  The type is the contract; this is the mirror.

    ``label`` is **not** in the payload and was removed from the TypeScript
    interface, because it cannot be filled honestly: the busy text lives in
    ``I->BusyMessage`` and there is no accessor for it.  Measured on this build
    (``bridge/tests/test_wf_ortho.py``): ``hasattr(cmd, 'get_busy')`` is False
    while ``hasattr(pymol._cmd, 'get_busy')`` is True, and ``_cmd.get_busy``
    answers a *flag*, not a string.  A field that is always ``''`` is worse
    than no field.

    ``busy`` is ``fraction >= 0``, which is Qt's own gate
    (``pymol_qt_gui.py:931-939``: ``progress = int(cmd.get_progress()*100)``
    then ``setVisible(progress >= 0)``).  The two spellings differ only for
    ``-0.005 < fraction < 0`` and ``cmd.get_progress()`` returns exactly
    ``-1.0`` when idle (measured across 82,015 samples, wave 8), so the
    difference is unobservable.

    ``abortable`` is ``busy`` on this backend, and that is a fact about the
    backend rather than a redundant field: ``cmd.interrupt`` is "asynch -- no
    locking" (``modules/pymol/locking.py:88``), so anything PyMOL reports
    progress for can be interrupted while the engine thread is still inside the
    C++ call.  The field exists so a producer that has a non-abortable job can
    say so.
    """
    fraction = float(progress)
    busy = fraction >= 0.0
    return {"fraction": fraction, "busy": busy, "abortable": busy}


#: ``mimic_tk``'s seven entry points -> the ``DialogKind`` vocabulary of
#: ``packages/protocol/src/topics/dialog.ts``.  The exact entry point is kept
#: alongside in ``entry`` — a plugin calling ``askopenfiles`` needs a list of
#: handles back and ``askopenfilename`` a single string, which the *kind* does
#: not distinguish and the *entry* does.
TK_DIALOG_KIND: Dict[str, str] = {
    "askopenfilename": "open-file",
    "askopenfilenames": "open-file",
    "askopenfile": "open-file",
    "askopenfiles": "open-file",
    "asksaveasfilename": "save-file",
    "asksaveasfile": "save-file",
    "askdirectory": "open-directory",
}


def plugin_dialog_payload(request: Mapping[str, Any], event: str) -> Dict[str, Any]:
    """One ``dialog`` topic payload for a blocked plugin file dialog.

    ``request`` is one row of ``DialogBroker.pending()``
    (``panels/files.py``): ``{dialogId, kind, options, waitingFor}``, where
    ``kind`` is the tkinter entry point.  ``event`` is ``'opened'`` or
    ``'closed'`` — the second one matters because a dialog also disappears
    when the blocked thread's 300 s timeout fires, and a UI that only ever
    hears about openings leaves a dead picker on screen.
    """
    entry = str(request.get("kind") or "")
    options = dict(request.get("options") or {})
    # `BridgeFileDialog._payload` has already run tkinter's `filetypes` through
    # `_getfilter`, byte-identical to `mimic_tk.py:37-48`, so what arrives is
    # Qt filter strings: `['PDB (*.pdb)', 'All (*.*)']`.  `DialogPayload.filters`
    # is declared as `[label, '*.pdb *.cif']` pairs, so split them back.
    filters = [_split_filter(part) for part in options.get("filters") or ()]
    payload: Dict[str, Any] = {
        "dialogId": int(request.get("dialogId", 0)),
        "kind": TK_DIALOG_KIND.get(entry, "open-file"),
        "entry": entry,
        "event": event,
        "title": str(options.get("title") or entry or "File"),
        "message": (
            "a plugin's Python thread is blocked in %s" % entry
            if event == "opened"
            else "%s is no longer waiting" % entry
        ),
        "options": options,
        "waitingFor": float(request.get("waitingFor", 0.0) or 0.0),
    }
    if filters:
        payload["filters"] = filters
    directory = options.get("initialdir")
    if directory:
        payload["directory"] = str(directory)
    initial = options.get("initialfile")
    if initial:
        payload["initial"] = str(initial)
    return payload


def _split_filter(part: Any) -> list:
    """``'PDB (*.pdb *.ent)'`` -> ``['PDB', '*.pdb *.ent']``.

    A filter with no parentheses (nothing produces one today, but a plugin may
    pass ``filetypes`` PyMOL never sees) becomes ``[text, '*']`` rather than
    being dropped: a picker that silently shows no filter is worse than one
    that shows a permissive one.
    """
    text = str(part)
    open_at = text.rfind("(")
    if open_at < 0 or not text.rstrip().endswith(")"):
        return [text, "*"]
    return [text[:open_at].strip(), text[open_at + 1 : text.rstrip().rfind(")")].strip()]


# -- binary framing ---------------------------------------------------------

_HEADER_STRUCT = struct.Struct("<I")

#: Must stay equal to ``GEOMETRY_HEADER_ALIGNMENT`` in
#: ``packages/protocol/src/geometry.ts``.
HEADER_ALIGNMENT = 4


def encode_binary_frame(meta: Mapping[str, Any], payload: bytes) -> bytes:
    header = json.dumps(meta, separators=(",", ":")).encode("utf-8")
    pad = (-(len(header) + _HEADER_STRUCT.size)) % HEADER_ALIGNMENT
    if pad:
        header += b" " * pad  # legal JSON whitespace, ignored by both parsers
    return _HEADER_STRUCT.pack(len(header)) + header + bytes(payload)


def decode_binary_frame(frame: bytes) -> Tuple[Dict[str, Any], memoryview]:
    if len(frame) < _HEADER_STRUCT.size:
        raise BadMessage("binary frame shorter than its header length field")
    (header_len,) = _HEADER_STRUCT.unpack_from(frame, 0)
    start = _HEADER_STRUCT.size
    end = start + header_len
    if end > len(frame):
        raise BadMessage(
            "binary frame truncated: header says %d bytes, %d available"
            % (header_len, len(frame) - start)
        )
    meta = json.loads(bytes(frame[start:end]).decode("utf-8"))
    return meta, memoryview(frame)[end:]


# -- subscriptions ----------------------------------------------------------


class Subscriptions:
    """Per-connection topic set with per-topic monotonic sequence numbers.

    Sequence numbers are per connection so a client can detect a dropped event
    without the server keeping global state; WP-08's store binding replays a
    resync on a gap.
    """

    __slots__ = ("_topics", "_seq")

    def __init__(self) -> None:
        self._topics: Set[str] = set()
        self._seq: Dict[str, int] = {}

    def add(self, topic: Any) -> str:
        name = validate_topic(topic)
        self._topics.add(name)
        self._seq.setdefault(name, 0)
        return name

    def remove(self, topic: Any) -> str:
        name = validate_topic(topic)
        self._topics.discard(name)
        return name

    def __contains__(self, topic: object) -> bool:
        return topic in self._topics

    def __iter__(self):
        return iter(sorted(self._topics))

    def __len__(self) -> int:
        return len(self._topics)

    def next_seq(self, topic: str) -> int:
        value = self._seq.get(topic, 0) + 1
        self._seq[topic] = value
        return value


# -- one connected client ---------------------------------------------------


_SESSION_SEQ = itertools.count(1)


class ClientSession:
    """Outbound bookkeeping for one WebSocket.

    Any thread may call :meth:`send_soon` (the status thread does); only the
    asyncio loop runs :meth:`writer`.  The outbox is bounded — a client that
    stops reading must not grow the server without limit.

    Every session has a small monotonic :attr:`id`.  It is the addressing unit:
    a route that answers with an out-of-band binary frame (Mode G geometry)
    sends it to the session that asked, and ``/healthz`` reports per-session
    counters so "did client B pay for client A's pull?" is answerable from the
    SERVER side rather than inferred from a client's own bookkeeping.  Do not
    use ``id(session)`` for this — CPython reuses addresses after a GC, and two
    sessions that never overlapped can share one.
    """

    def __init__(self, ws: Any, outbox_size: int = 2048) -> None:
        self.ws = ws
        self.id = next(_SESSION_SEQ)
        self.subs = Subscriptions()
        self.outbox: "asyncio.Queue[Any]" = asyncio.Queue(maxsize=outbox_size)
        self.loop = asyncio.get_running_loop()
        self.dropped = 0
        self.sent = 0
        #: server -> client binary frames and their total size.  Mode P pixel
        #: frames and Mode G geometry frames are the only binary traffic in
        #: protocol v1, and both are bulk, so this is the number that says
        #: whether a client was made to pay for somebody else's request.
        self.binary_sent = 0
        self.binary_bytes = 0
        self._closed = False
        self._tasks: Set[asyncio.Task] = set()

    # -- outbound ----------------------------------------------------------

    def send_soon(self, frame: Any) -> None:
        """Queue a frame from ANY thread."""
        if self._closed:
            return
        try:
            self.loop.call_soon_threadsafe(self._enqueue, frame)
        except RuntimeError:
            pass  # loop gone; the connection is dead anyway

    def _enqueue(self, frame: Any) -> None:
        try:
            self.outbox.put_nowait(frame)
        except asyncio.QueueFull:
            self.dropped += 1
            if self.dropped in (1, 100, 1000):
                log("outbox full, dropped %d frames for one client" % self.dropped)

    async def send(self, frame: Any) -> None:
        if self._closed:
            return
        await self.outbox.put(frame)

    async def send_binary(self, meta: Mapping[str, Any], payload: bytes) -> None:
        await self.outbox.put(encode_binary_frame(meta, payload))

    async def emit(self, topic: str, payload: Any) -> None:
        """Send an event only if this client subscribed to ``topic``."""
        if topic in self.subs:
            await self.send(event_frame(topic, self.subs.next_seq(topic), payload))

    def emit_soon(self, topic: str, payload: Any) -> None:
        if topic in self.subs:
            self.send_soon(event_frame(topic, self.subs.next_seq(topic), payload))

    async def writer(self) -> None:
        while True:
            frame = await self.outbox.get()
            if frame is None:
                return
            try:
                if isinstance(frame, (bytes, bytearray)):
                    await self.ws.send_bytes(bytes(frame))
                    self.binary_sent += 1
                    self.binary_bytes += len(frame)
                else:
                    await self.ws.send_json(frame)
            except (TypeError, ValueError) as exc:
                # NOT a dead socket: the FRAME could not be serialised.
                #
                # These two cases used to be one `except Exception: return`,
                # and the consequence was severe out of all proportion to the
                # cause. `cmd.get_scene_thumbnail` returns `bytes`, which
                # `codec.encode` passes through (legal inside a binary frame,
                # where ndarray payloads live) but `send_json` cannot encode.
                # The writer task then exited, the socket stayed OPEN, and the
                # client never received another reply to anything — measured:
                # the call itself timed out at 60 s and so did every subsequent
                # call on that connection. A hang, with no error, forever.
                #
                # The frame is dropped, the caller is told why, and the writer
                # keeps running.
                if not await self._report_unsendable(frame, exc):
                    return
                continue
            except Exception:  # noqa: BLE001 - the socket really did die
                return
            self.sent += 1

    async def _report_unsendable(self, frame: Any, exc: Exception) -> bool:
        """Tell the client its reply could not be encoded. False to give up.

        Best effort by construction: the error frame is plain strings, so the
        only way it can fail in turn is a genuinely dead socket — and in that
        case there is nothing left to say.
        """
        msg_id = frame.get("id") if isinstance(frame, Mapping) else None
        try:
            await self.ws.send_json(
                err_frame(
                    msg_id,
                    {
                        "kind": "NotSerializable",
                        "type": type(exc).__name__,
                        "message": (
                            "the result could not be encoded for the wire: %s. "
                            "Binary returns must go through a blob or a panel "
                            "route (for example `cmd.get_scene_thumbnail_png` "
                            "rather than `cmd.get_scene_thumbnail`)." % exc
                        ),
                    },
                )
            )
        except Exception:  # noqa: BLE001 - now the socket really is gone
            return False
        self.sent += 1
        return True

    # -- task bookkeeping ---------------------------------------------------

    def spawn(self, coro: Any) -> None:
        task = self.loop.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def close(self) -> None:
        self._closed = True
        for task in list(self._tasks):
            task.cancel()
        try:
            self.outbox.put_nowait(None)
        except asyncio.QueueFull:
            pass

    @property
    def closed(self) -> bool:
        return self._closed

    def stats(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "topics": list(self.subs),
            "sent": self.sent,
            "binarySent": self.binary_sent,
            "binaryBytes": self.binary_bytes,
            "dropped": self.dropped,
            "queued": self.outbox.qsize(),
        }
