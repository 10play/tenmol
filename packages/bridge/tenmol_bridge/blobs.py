"""Out-of-band payloads: ray images, sessions, exports, volume fields.

Anything that must not travel inside a JSON/msgpack frame becomes a blob with
an opaque id, fetched over ``GET /blob/{id}`` (WP-19's ray images, WP-18's
exports, and the ``BLOB_RETURNS`` table in :mod:`tenmol_bridge.codec`).

The store is in-memory with a byte budget and a TTL, plus a
"file-backed" mode for things PyMOL wrote to disk itself (``cmd.png``,
``cmd.save``), where copying the bytes into RAM buys nothing.
"""

from __future__ import annotations

import mimetypes
import os
import secrets
import tempfile
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .errors import BridgeError, NotSerializable

__all__ = ["Blob", "BlobStore", "EngineBlobWriter", "BlobNotFound"]


class BlobNotFound(BridgeError):
    """Raised when a blob id is unknown, evicted, or has no bytes to read."""

    pass


@dataclass
class Blob:
    """One out-of-band payload: either in-memory ``data`` or a file ``path``.

    A blob carries its own mime type and size plus optional ``meta`` the client
    needs to interpret the bytes; file-backed blobs skip copying PyMOL's output
    into RAM and may own the file so eviction deletes it.
    """

    id: str
    mime: str
    size: int
    name: str = ""
    created: float = field(default_factory=time.monotonic)
    data: Optional[bytes] = None
    path: Optional[str] = None
    #: extra header the client needs to interpret the bytes (shape/dtype/...)
    meta: Dict[str, Any] = field(default_factory=dict)
    #: delete ``path`` when the blob is evicted (we created the file)
    owns_file: bool = False

    def read(self) -> bytes:
        """The blob's bytes, from memory or by reading its backing file.

        Raises :class:`BlobNotFound` if the blob has neither data nor a path.
        """
        if self.data is not None:
            return self.data
        if self.path is not None:
            with open(self.path, "rb") as handle:
                return handle.read()
        raise BlobNotFound("blob %s has neither data nor path" % self.id)

    def as_wire(self) -> Dict[str, Any]:
        """The blob's JSON placeholder: a ``__blob__`` handle with its fetch URL.

        This is what rides inside a frame in place of the bytes; the client
        follows ``url`` (``/blob/{id}``) to retrieve the payload out of band.
        """
        out: Dict[str, Any] = {
            "__blob__": True,
            "id": self.id,
            "mime": self.mime,
            "size": self.size,
            "url": "/blob/%s" % self.id,
        }
        if self.name:
            out["name"] = self.name
        if self.meta:
            out["meta"] = self.meta
        return out


class BlobStore:
    """Bounded LRU-ish blob store.  Thread-safe; any thread may put or get."""

    def __init__(
        self,
        max_bytes: int = 512 * 1024 * 1024,
        ttl_seconds: float = 3600.0,
    ) -> None:
        self.max_bytes = max_bytes
        self.ttl_seconds = ttl_seconds
        self._blobs: Dict[str, Blob] = {}
        self._order: List[str] = []
        self._bytes = 0
        self._lock = threading.Lock()

    # -- put ---------------------------------------------------------------

    def put(
        self,
        data: bytes,
        mime: str = "application/octet-stream",
        name: str = "",
        meta: Optional[Dict[str, Any]] = None,
    ) -> Blob:
        """Store in-memory ``data`` as a new blob and return its handle.

        The bytes are copied and counted against the store's byte budget.
        """
        blob = Blob(
            id=secrets.token_urlsafe(16),
            mime=mime,
            size=len(data),
            name=name,
            data=bytes(data),
            meta=dict(meta or {}),
        )
        return self._insert(blob)

    def put_file(
        self,
        path: str,
        mime: Optional[str] = None,
        name: str = "",
        owns_file: bool = False,
        meta: Optional[Dict[str, Any]] = None,
    ) -> Blob:
        """Register an on-disk file as a blob without copying it into RAM.

        The mime type is guessed from the extension when not given; pass
        ``owns_file`` so eviction deletes the file the store created.
        """
        if not os.path.isfile(path):
            raise BlobNotFound("no such file: %s" % path)
        guessed = mime or mimetypes.guess_type(path)[0] or "application/octet-stream"
        blob = Blob(
            id=secrets.token_urlsafe(16),
            mime=guessed,
            size=os.path.getsize(path),
            name=name or os.path.basename(path),
            path=path,
            owns_file=owns_file,
            meta=dict(meta or {}),
        )
        return self._insert(blob)

    def _insert(self, blob: Blob) -> Blob:
        with self._lock:
            self._blobs[blob.id] = blob
            self._order.append(blob.id)
            if blob.data is not None:
                self._bytes += blob.size
            self._evict_locked()
        return blob

    # -- get ---------------------------------------------------------------

    def get(self, blob_id: str) -> Blob:
        """The blob for ``blob_id``, or raise :class:`BlobNotFound`."""
        with self._lock:
            blob = self._blobs.get(blob_id)
        if blob is None:
            raise BlobNotFound("no blob %r" % blob_id)
        return blob

    def drop(self, blob_id: str) -> None:
        """Evict a single blob, deleting its file if the store owns it."""
        with self._lock:
            self._drop_locked(blob_id)

    def stats(self) -> Dict[str, Any]:
        """Current blob count, byte usage, and the configured budget/TTL."""
        with self._lock:
            return {
                "count": len(self._blobs),
                "bytes": self._bytes,
                "maxBytes": self.max_bytes,
                "ttlSeconds": self.ttl_seconds,
            }

    def clear(self) -> None:
        """Evict every blob, deleting any files the store owns."""
        with self._lock:
            for blob_id in list(self._blobs):
                self._drop_locked(blob_id)

    # -- eviction ----------------------------------------------------------

    def _drop_locked(self, blob_id: str) -> None:
        blob = self._blobs.pop(blob_id, None)
        if blob is None:
            return
        if blob_id in self._order:
            self._order.remove(blob_id)
        if blob.data is not None:
            self._bytes -= blob.size
        if blob.owns_file and blob.path:
            try:
                os.unlink(blob.path)
            except OSError:
                pass

    def _evict_locked(self) -> None:
        now = time.monotonic()
        for blob_id in list(self._order):
            blob = self._blobs.get(blob_id)
            if blob is None:
                continue
            if self.ttl_seconds and now - blob.created > self.ttl_seconds:
                self._drop_locked(blob_id)
        while self._bytes > self.max_bytes and self._order:
            self._drop_locked(self._order[0])


class EngineBlobWriter:
    """``blob_writer`` for :func:`tenmol_bridge.codec.encode_result`.

    Runs on the engine thread, inside the same task as the call, so the
    copy-before-unlock rule holds for the numpy cases (plan §B8).
    """

    def __init__(self, store: BlobStore, engine: Any) -> None:
        self.store = store
        self.engine = engine

    def __call__(self, symbol: str, value: Any) -> Dict[str, Any]:
        leaf = symbol.rsplit(".", 1)[-1]
        if leaf == "get_session":
            return self._session_blob(value)
        if leaf in ("get_volume_field", "get_volume_histogram"):
            return self._array_blob(leaf, value)
        if isinstance(value, (bytes, bytearray)):
            return self.store.put(bytes(value), name=leaf).as_wire()
        if isinstance(value, str):
            return self.store.put(
                value.encode("utf-8"), mime="text/plain; charset=utf-8", name=leaf
            ).as_wire()
        if isinstance(value, (list, tuple)):
            # get_idtf() returns a 2-tuple of strings; keep both parts.
            parts = [
                self(symbol + "[%d]" % index, item) for index, item in enumerate(value)
            ]
            return {"__blobs__": parts}
        raise NotSerializable(
            "no blob encoding for %s returning %s" % (symbol, type(value).__name__),
            symbol=symbol,
        )

    # -- cases -------------------------------------------------------------

    def _session_blob(self, value: Any) -> Dict[str, Any]:
        """A session dict never goes on the wire (plan §B8).

        We ask PyMOL to write a real ``.pse`` instead of pickling the dict
        ourselves: ``cmd.save`` is the only writer that knows the current
        session format.
        """
        cmd = getattr(self.engine, "cmd", None)
        if cmd is None:
            raise NotSerializable("cannot materialise a session without PyMOL")
        handle, path = tempfile.mkstemp(prefix="tenmol-session-", suffix=".pse")
        os.close(handle)
        cmd.save(path, format="pse")
        return self.store.put_file(
            path, mime="application/octet-stream", owns_file=True
        ).as_wire()

    def _array_blob(self, leaf: str, value: Any) -> Dict[str, Any]:
        if type(value).__module__ == "numpy" and type(value).__name__ == "ndarray":
            contiguous = value if value.flags["C_CONTIGUOUS"] else value.copy(order="C")
            meta = {"shape": list(value.shape), "dtype": str(value.dtype)}
            # tobytes() copies, which is the point: the caller may be holding a
            # live view onto C++ memory (packages/engine/layer2/CoordSet.cpp:326-361).
            return self.store.put(
                contiguous.tobytes(), name=leaf, meta=meta
            ).as_wire()
        raise NotSerializable(
            "%s returned %s, expected a numpy array" % (leaf, type(value).__name__)
        )
