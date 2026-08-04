"""Wire-protocol constants and helpers for the tenmol bridge.

This module is the single source of truth on the Python side for the v1 wire
protocol.  It is deliberately tiny and dependency-free so that tests, the pump
thread and the asyncio server can all import it without pulling in FastAPI or
PyMOL.

The protocol is frozen at v1 (see the project brief).  Do NOT add topics or
message types here without a protocol-version bump agreed with the TypeScript
side (``packages/protocol``), which mirrors these exact strings.

Transport
---------
One WebSocket at ``ws://127.0.0.1:8765/ws``.

* JSON text frames for control/RPC/events.
* Binary frames (server -> client only) for geometry payloads:

      | uint32 LE header length | UTF-8 JSON metadata | raw typed-array bytes |
"""

from __future__ import annotations

import json
import struct
from typing import Any, Dict, Iterable, Mapping, Optional, Set, Tuple

PROTOCOL_VERSION = 1

# --------------------------------------------------------------------------
# Message type tags ("t")
# --------------------------------------------------------------------------

# client -> server
T_CALL = "call"
T_DO = "do"
T_INPUT = "input"
T_SUB = "sub"
T_UNSUB = "unsub"

CLIENT_MESSAGE_TYPES = frozenset({T_CALL, T_DO, T_INPUT, T_SUB, T_UNSUB})

# server -> client
T_OK = "ok"
T_ERR = "err"
T_EVENT = "event"
T_FEEDBACK = "feedback"
T_HELLO = "hello"

SERVER_MESSAGE_TYPES = frozenset({T_OK, T_ERR, T_EVENT, T_FEEDBACK, T_HELLO})

# input message "kind"
INPUT_BUTTON = "button"
INPUT_DRAG = "drag"
INPUT_RESHAPE = "reshape"

INPUT_KINDS = frozenset({INPUT_BUTTON, INPUT_DRAG, INPUT_RESHAPE})

# --------------------------------------------------------------------------
# Topics
# --------------------------------------------------------------------------

TOPIC_OBJECTS = "objects"
TOPIC_VIEW = "view"
TOPIC_FRAME = "frame"
TOPIC_SELECTION = "selection"
TOPIC_SETTINGS = "settings"
TOPIC_FEEDBACK = "feedback"
TOPIC_GEOMETRY = "geometry"

#: The complete, closed set of v1 topics.  Reserved: do not extend.
TOPICS: frozenset = frozenset(
    {
        TOPIC_OBJECTS,
        TOPIC_VIEW,
        TOPIC_FRAME,
        TOPIC_SELECTION,
        TOPIC_SETTINGS,
        TOPIC_FEEDBACK,
        TOPIC_GEOMETRY,
    }
)


class UnknownTopic(ValueError):
    """Raised when a client subscribes to a topic outside the v1 set."""

    def __init__(self, topic: str) -> None:
        super().__init__(
            "unknown topic %r; v1 topics are: %s"
            % (topic, ", ".join(sorted(TOPICS)))
        )
        self.topic = topic


def validate_topic(topic: Any) -> str:
    if not isinstance(topic, str) or topic not in TOPICS:
        raise UnknownTopic(topic)
    return topic


# --------------------------------------------------------------------------
# Frame builders (server -> client)
# --------------------------------------------------------------------------


def hello_frame(pymol_version: str) -> Dict[str, Any]:
    return {"t": T_HELLO, "pymolVersion": pymol_version,
            "protocolVersion": PROTOCOL_VERSION}


def ok_frame(msg_id: Optional[int], result: Any) -> Dict[str, Any]:
    return {"id": msg_id, "t": T_OK, "result": result}


def err_frame(msg_id: Optional[int], type_: str, message: str,
              traceback_: str = "") -> Dict[str, Any]:
    return {
        "id": msg_id,
        "t": T_ERR,
        "error": {"type": type_, "message": message, "traceback": traceback_},
    }


def event_frame(topic: str, seq: int, payload: Any) -> Dict[str, Any]:
    return {"t": T_EVENT, "topic": topic, "seq": seq, "payload": payload}


def feedback_frame(lines: Iterable[str]) -> Dict[str, Any]:
    return {"t": T_FEEDBACK, "lines": list(lines)}


# --------------------------------------------------------------------------
# Binary geometry frames
# --------------------------------------------------------------------------

_HEADER_STRUCT = struct.Struct("<I")

#: The JSON header is space-padded so the payload starts on a multiple of this
#: many bytes.  Must stay equal to ``GEOMETRY_HEADER_ALIGNMENT`` in
#: ``packages/protocol/src/geometry.ts``.  Without it the TypeScript decoder has
#: to memcpy every buffer instead of returning a zero-copy Float32Array view
#: (measured: object names 'a'/'ab'/'abc' put the payload at byte 237/238/239).
HEADER_ALIGNMENT = 4


def encode_binary_frame(meta: Mapping[str, Any], payload: bytes) -> bytes:
    """Pack ``meta`` + ``payload`` into a v1 binary geometry frame.

    Layout: 4-byte little-endian uint32 header length, that many bytes of
    UTF-8 JSON metadata, then the raw typed-array payload.

    The JSON metadata is padded with trailing spaces (legal JSON whitespace,
    ignored by both ``json.loads`` and ``JSON.parse``) so that
    ``4 + header_length`` is a multiple of :data:`HEADER_ALIGNMENT` and the
    payload lands 4-byte aligned.

    ``meta`` should at minimum carry ``topic`` and enough shape/dtype
    information for the client to build a typed array.  WP-06 owns the
    metadata schema; this function only owns the framing.
    """
    header = json.dumps(meta, separators=(",", ":")).encode("utf-8")
    pad = (-len(header)) % HEADER_ALIGNMENT
    if pad:
        header += b" " * pad
    return _HEADER_STRUCT.pack(len(header)) + header + bytes(payload)


def decode_binary_frame(frame: bytes) -> Tuple[Dict[str, Any], memoryview]:
    """Inverse of :func:`encode_binary_frame` (used by tests / tooling)."""
    if len(frame) < _HEADER_STRUCT.size:
        raise ValueError("binary frame shorter than its header length field")
    (header_len,) = _HEADER_STRUCT.unpack_from(frame, 0)
    start = _HEADER_STRUCT.size
    end = start + header_len
    if end > len(frame):
        raise ValueError(
            "binary frame truncated: header says %d bytes, only %d available"
            % (header_len, len(frame) - start)
        )
    meta = json.loads(bytes(frame[start:end]).decode("utf-8"))
    return meta, memoryview(frame)[end:]


# --------------------------------------------------------------------------
# Per-connection subscription bookkeeping
# --------------------------------------------------------------------------


class Subscriptions:
    """The set of topics one WebSocket connection is subscribed to.

    Sequence numbers are per-connection-per-topic and monotonic, so a client
    can detect a dropped event without the server keeping global state.
    """

    __slots__ = ("_topics", "_seq")

    def __init__(self) -> None:
        self._topics: Set[str] = set()
        self._seq: Dict[str, int] = {}

    def add(self, topic: str) -> str:
        topic = validate_topic(topic)
        self._topics.add(topic)
        self._seq.setdefault(topic, 0)
        return topic

    def remove(self, topic: str) -> str:
        topic = validate_topic(topic)
        self._topics.discard(topic)
        return topic

    def __contains__(self, topic: object) -> bool:
        return topic in self._topics

    def __iter__(self):
        return iter(sorted(self._topics))

    def next_seq(self, topic: str) -> int:
        n = self._seq.get(topic, 0) + 1
        self._seq[topic] = n
        return n
