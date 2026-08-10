"""WP-04 — Mode P (server pixel stream) and Mode G (geometry over the wire).

Run with the venv that has the PyMOL built from this tree::

    cd bridge && python -m pytest tests/test_render.py -q

The ``gl``-marked tests need a real offscreen context (on macOS, a logged-in
WindowServer session); they skip otherwise, the same way the ray image-diff
suites are gated.  Everything in "part 1" runs anywhere — no PyMOL, no GL.

The benchmark at the bottom is the plan's WP-04 acceptance: 1AON, 100
``turn``+frame cycles at 1280x960, median end-to-end frame time <= 6 ms and a
decoded image with > 1,000 unique RGB values (a real render, not a fill).
"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tenmol_bridge.render import (  # noqa: E402
    MODE_G_CAPABLE_REPS,
    REP_NAMES,
    GeometryService,
    RenderService,
    StreamParams,
    Subscriber,
    encode,
    pixel_frame_header,
    rep_id,
)
from tenmol_bridge.render import modeg  # noqa: E402
from tenmol_bridge.render.encode import (  # noqa: E402
    AdaptiveQuality,
    EncodedImage,
    encode_png_stdlib,
    encode_rgba,
    sniff_image,
)
from tenmol_bridge.session import decode_binary_frame  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
GEOMETRY_TS = REPO / "packages" / "protocol" / "src" / "geometry.ts"
TENMOL_WIRE = REPO / "packages" / "protocol" / "python" / "tenmol_wire.py"
PDB_1AON = REPO / "packages" / "engine" / "testing" / "data" / "1aon.pdb.gz"
PDB_SMALL = REPO / "packages" / "engine" / "testing" / "data" / "1rx1.pdb"

BENCH_W, BENCH_H = 1280, 960


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


class ListSink:
    """A client that records frames.  ``send_soon`` is the whole contract."""

    def __init__(self, name: str = "sink") -> None:
        self.name = name
        self.frames: List[bytes] = []
        self.depth = 0
        self.last_frame_id = 0

    def send_soon(self, frame: Any) -> None:
        raw = bytes(frame)
        self.frames.append(raw)
        try:
            self.last_frame_id = int(decode_binary_frame(raw)[0].get("frameId", 0))
        except Exception:  # noqa: BLE001
            pass

    def queued(self) -> int:
        return self.depth

    def decoded(self, index: int = -1):
        return decode_binary_frame(self.frames[index])

    def headers(self) -> List[Dict[str, Any]]:
        return [decode_binary_frame(f)[0] for f in self.frames]


def gradient_rgba(width: int, height: int) -> bytes:
    """A bottom-up RGBA buffer whose top and bottom halves are different.

    Row 0 (the BOTTOM of the image, ``glReadPixels`` convention) is red;
    the last row (the TOP) is blue.  That asymmetry is what the flip test uses.
    """
    out = bytearray(width * height * 4)
    for y in range(height):
        blue = int(255 * y / max(1, height - 1))
        row = bytes((255 - blue, (y * 7) % 256, blue, 255)) * width
        out[y * width * 4 : (y + 1) * width * 4] = row
    return bytes(out)


def ts_constant(source: str, name: str) -> str:
    """Pull ``export const <name> = ... ;`` out of the TypeScript source."""
    match = re.search(
        r"export const %s\b\s*(?::[^=]+)?=\s*(.*?);\s*\n" % re.escape(name),
        source,
        re.S,
    )
    assert match, "no `export const %s` in geometry.ts" % name
    return match.group(1)


def load_tenmol_wire():
    """Import ``packages/protocol/python/tenmol_wire.py`` by path (WP-01's)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("tenmol_wire", TENMOL_WIRE)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def decode_image(payload: bytes):
    from PIL import Image
    import io

    return Image.open(io.BytesIO(payload))


def unique_rgb(image) -> int:
    colors = image.convert("RGB").getcolors(maxcolors=1 << 24)
    return len(colors or ())


# =========================================================================== #
# Part 1 — encode: pure, no PyMOL, no GL
# =========================================================================== #


def test_encoder_capabilities_are_reported_not_assumed():
    caps = encode.capabilities()
    assert isinstance(caps["pillow"], bool)
    assert "png" in caps["encodings"] and "raw-rgba" in caps["encodings"]
    if caps["pillow"]:
        assert set(caps["encodings"]) == set(encode.PIXEL_ENCODINGS)
    print("encoder capabilities:", json.dumps(caps, sort_keys=True))


@pytest.mark.parametrize("encoding", ["jpeg", "png", "webp", "raw-rgba"])
def test_every_encoding_produces_a_decodable_payload(encoding):
    if encoding not in encode.supported_encodings():
        pytest.skip("%s needs Pillow" % encoding)
    width, height = 160, 120
    buf = gradient_rgba(width, height)
    image = encode_rgba(buf, width, height, encoding=encoding, quality=80)

    assert image.encoding == encoding
    assert image.width == width and image.height == height
    if encoding == "raw-rgba":
        assert len(image.data) == width * height * 4
        assert image.flip_y is True  # never flipped: it IS the buffer
        return

    assert sniff_image(image.data) == encoding
    decoded = decode_image(image.data)
    assert decoded.size == (width, height)
    assert image.flip_y is False  # flipped server side, so the client can blit
    assert image.lossless == (encoding in ("png", "raw-rgba"))


def test_the_vertical_flip_is_actually_applied():
    """``glReadPixels`` is bottom-up; a canvas is top-down."""
    width, height = 64, 48
    buf = gradient_rgba(width, height)  # row 0 red, last row blue

    flipped = decode_image(
        encode_rgba(buf, width, height, "png", flip=True).data
    ).convert("RGB")
    unflipped = encode_rgba(buf, width, height, "png", flip=False)
    raw = decode_image(unflipped.data).convert("RGB")

    # After the flip the TOP row of the image is the LAST row of the buffer.
    assert flipped.getpixel((0, 0))[2] > 200, "top row should be blue"
    assert flipped.getpixel((0, height - 1))[0] > 200, "bottom row should be red"
    # Without it, both the pixels and the honest flipY flag are inverted.
    assert raw.getpixel((0, 0))[0] > 200
    assert unflipped.flip_y is True


def test_stdlib_png_fallback_is_pixel_identical_to_pillow():
    """No Pillow must still mean a LOSSLESS still, not a silent JPEG."""
    width, height = 64, 48
    buf = gradient_rgba(width, height)
    data = encode_png_stdlib(buf, width, height, flip=True, alpha=False)
    assert sniff_image(data) == "png"

    if not encode.have_pillow():
        pytest.skip("no Pillow to compare against")
    mine = decode_image(data).convert("RGB")
    theirs = decode_image(
        encode_rgba(buf, width, height, "png", flip=True, alpha=False).data
    ).convert("RGB")
    assert mine.size == theirs.size
    assert list(mine.getdata()) == list(theirs.getdata())


def test_stdlib_png_keeps_alpha_when_asked():
    width, height = 8, 4
    buf = bytearray(gradient_rgba(width, height))
    buf[3] = 17  # one non-opaque pixel
    data = encode_png_stdlib(bytes(buf), width, height, flip=False, alpha=True)
    image = decode_image(data)
    assert image.mode == "RGBA"
    assert image.getpixel((0, 0))[3] == 17


def test_a_short_framebuffer_raises_instead_of_encoding_garbage():
    with pytest.raises(encode.EncodeError):
        encode_rgba(b"\0" * 16, 64, 48, "png")


def test_unknown_encoding_raises_and_known_ones_resolve():
    with pytest.raises(encode.EncodeError):
        encode.resolve_encoding("gif")
    assert encode.resolve_encoding("png") == "png"
    assert encode.resolve_encoding("jpeg") in encode.supported_encodings()


def test_adaptive_quality_walks_down_fast_and_up_slowly():
    quality = AdaptiveQuality(base=80, minimum=30, step_down=10, step_up=5,
                              recover_after=3, budget_ms=6.0)
    assert quality.quality == 80
    for _ in range(3):
        quality.observe(1.0, skipped=True)
    assert quality.quality == 50, "three skips must cost three steps"
    quality.observe(99.0)  # a slow encode is also evidence
    assert quality.quality == 40
    for _ in range(3):
        quality.observe(1.0)
    assert quality.quality == 45, "recovery is one step per recover_after frames"
    for _ in range(100):
        quality.observe(1.0)
    assert quality.quality == 80, "it must climb back to the client's ceiling"
    assert quality.quality <= quality.base


def test_quality_never_leaves_its_bounds():
    quality = AdaptiveQuality(base=80, minimum=30)
    for _ in range(50):
        quality.penalise()
    assert quality.quality == 30


# =========================================================================== #
# Part 2 — the wire format, checked against packages/protocol
# =========================================================================== #


@pytest.mark.skipif(not TENMOL_WIRE.exists(), reason="packages/protocol not present")
def test_pixel_frames_are_byte_identical_to_the_protocol_packages_encoder():
    """WP-01: "a second hand-rolled encoder in packages/bridge/ will silently break
    zero-copy".  So prove there is not one."""
    wire = load_tenmol_wire()
    for payload_len in (0, 1, 3, 4, 1023, 65536):
        image = EncodedImage(
            data=b"\x89PNG\r\n\x1a\n" + b"x" * max(0, payload_len - 8),
            encoding="png",
            width=1280,
            height=960,
            flip_y=False,
            quality=None,
            encode_ms=0.0,
        )
        mine = pixel_frame_header(image, frame_id=7, seq=3, dpr=2.0)
        theirs = wire.pixel_header(
            width=1280,
            height=960,
            dpr=2.0,
            encoding="png",
            frame_id=7,
            seq=3,
            flip_y=False,
        )
        # Mine carries two ADDITIVE diagnostics keys; every shared key must match.
        for key, value in theirs.items():
            if key == "payloadBytes":
                continue
            assert mine[key] == value, key
        assert set(mine) - set(theirs) <= {"encodeMs", "still", "quality"}

        from tenmol_bridge.session import encode_binary_frame

        frame_mine = encode_binary_frame(mine, image.data)
        frame_theirs = wire.encode_binary_frame(mine, image.data)
        assert frame_mine == frame_theirs, "framing diverged at %d bytes" % payload_len

        header, payload = wire.decode_binary_frame(frame_mine)
        assert header["kind"] == "pixels"
        assert bytes(payload) == image.data
        assert (4 + struct.unpack_from("<I", frame_mine)[0]) % 4 == 0


@pytest.mark.skipif(not GEOMETRY_TS.exists(), reason="packages/protocol not present")
def test_constants_mirror_packages_protocol_geometry_ts():
    source = GEOMETRY_TS.read_text()

    encodings = re.findall(r"'([a-z-]+)'", ts_constant(source, "PIXEL_ENCODINGS"))
    assert tuple(encodings) == encode.PIXEL_ENCODINGS

    lossless = re.findall(
        r"'([a-z-]+)'", ts_constant(source, "LOSSLESS_PIXEL_ENCODINGS")
    )
    assert tuple(lossless) == encode.LOSSLESS_PIXEL_ENCODINGS

    # REP_NAMES is keyed by `[Rep.X]`, so resolve Rep first.
    rep_block = ts_constant(source, "Rep")
    rep_values = {
        key: int(value)
        for key, value in re.findall(r"(\w+):\s*(-?\d+)", rep_block)
    }
    name_block = ts_constant(source, "REP_NAMES")
    names = {
        rep_values[key]: value
        for key, value in re.findall(r"\[Rep\.(\w+)\]:\s*'([a-z_]+)'", name_block)
    }
    assert names == REP_NAMES, "cRep_t table drifted from geometry.ts"

    item_block = ts_constant(source, "INSTANCE_ITEM_SIZE")
    sizes = {
        key: int(value)
        for key, value in re.findall(r"(\w+):\s*(\d+)", item_block)
    }
    assert sizes == modeg.INSTANCE_ITEM_SIZE

    capable_block = ts_constant(source, "MODE_G_CAPABLE_REPS")
    capable = {rep_values[key] for key in re.findall(r"Rep\.(\w+)", capable_block)}
    assert set(MODE_G_CAPABLE_REPS) <= capable, (
        "the bridge claims a rep geometry.ts does not: %s"
        % sorted(set(MODE_G_CAPABLE_REPS) - capable)
    )


def test_packer_keeps_every_buffer_four_byte_aligned():
    packer = modeg._Packer()
    refs = [
        packer.add(b"\x01" * 3, "u8", 1),
        packer.add(struct.pack("<3f", 1.0, 2.0, 3.0), "f32", 3),
        packer.add(b"\x02" * 5, "u8", 1),
        packer.add(struct.pack("<2i", 4, 5), "i32", 1),
    ]
    payload = packer.payload()
    for ref in refs:
        if ref["dtype"] != "u8":
            assert ref["byteOffset"] % 4 == 0, ref
        assert ref["byteOffset"] + ref["byteLength"] <= len(payload)
    assert payload[refs[1]["byteOffset"] : refs[1]["byteOffset"] + 12] == struct.pack(
        "<3f", 1.0, 2.0, 3.0
    )


def test_draw_arrays_block_is_concatenated_with_the_skipped_pick_slot():
    """``cgoArraysLayout()`` expects ``[vertex 3N][pickRGBA 1N][pickIdx 2N]``.

    CONSECUTIVE sub-arrays, not interleaved per vertex, and the packed-RGBA
    slot the accessor drops must be re-inserted as zeros or every later
    sub-array is shifted.
    """
    nverts = 3
    vertex = struct.pack("<9f", *[float(i) for i in range(9)])
    pick = struct.pack("<6i", 10, -1, 11, -1, 12, -1)
    data = modeg._concat_f32([(vertex, 3), (None, 1), (pick, 2)], nverts)
    assert len(data) == nverts * 6 * 4
    floats = struct.unpack("<%df" % (nverts * 6), data)
    assert floats[0:9] == tuple(float(i) for i in range(9))
    assert floats[9:12] == (0.0, 0.0, 0.0), "the skipped pick-RGBA slot is zeros"
    reread = struct.unpack("<6i", data[12 * 4 :])
    assert reread == (10, -1, 11, -1, 12, -1)


def test_instance_buffers_are_interleaved_per_item_not_concatenated():
    """The other half of the pair: a GPU instance attribute IS interleaved."""
    xyzr = struct.pack("<8f", 1, 2, 3, 0.5, 10, 20, 30, 1.5)
    rgba = struct.pack("<8f", 1, 0, 0, 1, 0, 1, 0, 1)
    data = modeg._interleave_f32([(xyzr, 4), (rgba, 4)], 2)
    assert len(data) == 2 * modeg.INSTANCE_ITEM_SIZE["sphere"] * 4
    values = struct.unpack("<16f", data)
    assert values[0:8] == (1, 2, 3, 0.5, 1, 0, 0, 1)
    assert values[8:16] == (10, 20, 30, 1.5, 0, 1, 0, 1)


def test_deinterleave_splits_atom_and_bond():
    pick = struct.pack("<6i", 7, -1, 8, -1, 9, 42)
    atoms = struct.unpack("<3i", modeg._deinterleave_i32(pick, 2, 0))
    bonds = struct.unpack("<3i", modeg._deinterleave_i32(pick, 2, 1))
    assert atoms == (7, 8, 9)
    assert bonds == (-1, -1, 42)


def test_rep_ids_accept_names_indices_and_aliases():
    assert rep_id("cartoon") == 5
    assert rep_id(5) == 5
    assert rep_id("5") == 5
    assert rep_id("sphere") == rep_id("spheres") == 1
    with pytest.raises(Exception):
        rep_id("no-such-rep")
    with pytest.raises(Exception):
        rep_id(99)


def test_geometry_keys_survive_names_with_separators():
    key = GeometryService.key("a b/c.d", 2, "cartoon")
    assert key.split("\x00") == ["a b/c.d", "2", "5"]
    assert GeometryService.parse_key(key) == ("a b/c.d", 2, 5)


# =========================================================================== #
# Part 3 — flow control, without an engine
# =========================================================================== #


def test_at_most_one_unacked_frame_is_in_flight():
    params = StreamParams(max_in_flight=1, ack_timeout_s=1e6).clamp()
    sub = Subscriber(key="c", sink=ListSink())
    now = time.monotonic()

    assert sub.blocked(params, now) is None
    sub.record_sent(1, 1000, now)
    assert sub.blocked(params, now) == "unacked", "a second frame must be refused"

    assert sub.ack(1) is True
    assert sub.blocked(params, now) is None
    assert sub.ack(1) is False, "a replayed ack must not open the window twice"
    assert sub.ack(99) is False, "an ack for a frame we never sent is ignored"


def test_a_client_that_never_acks_still_gets_a_live_viewport():
    """Liveness beats flow control: the window opens again after the timeout."""
    params = StreamParams(max_in_flight=1, ack_timeout_s=0.05).clamp()
    sub = Subscriber(key="c", sink=ListSink())
    now = time.monotonic()
    sub.record_sent(1, 1000, now)
    assert sub.blocked(params, now) == "unacked"
    assert sub.blocked(params, now + 0.06) is None
    assert sub.ack_timeouts == 1


def test_a_deep_outbox_blocks_even_when_acks_are_current():
    params = StreamParams(max_outbox=2).clamp()
    sink = ListSink()
    sub = Subscriber(key="c", sink=sink)
    assert sub.blocked(params, time.monotonic()) is None
    sink.depth = 9
    assert sub.blocked(params, time.monotonic()) == "outbox"


def test_mode_g_is_unavailable_on_a_degraded_bridge():
    """``from pymol import _cmd`` succeeds in a bridge where PyMOL never started.

    Checking only for the symbol reported Mode G as available on a DEGRADED
    process, and ``set_render_mode('geometry')`` then promised every rep a
    client-side render that could never arrive.
    """

    class DeadEngine:
        cmd = None
        p = None
        context = None

    class DeadPump:
        engine = DeadEngine()

        def add_tick_hook(self, hook):
            pass

        def remove_tick_hook(self, hook):
            pass

    service = GeometryService(DeadPump())
    caps = service.capabilities()
    assert caps["accessor"] is False
    assert caps["fallbackReason"] == "no-accessor"

    render = RenderService(DeadPump())
    modes = render.set_render_mode(default="geometry")["modes"]
    assert all(entry["effective"] == "pixel" for entry in modes)
    assert all(entry["fallbackReason"] == "no-accessor" for entry in modes)


def test_stream_params_clamp_hostile_input():
    params = StreamParams(
        quality=100000, dpr=-3, max_fps=0, max_in_flight=0, settle_scale=99
    ).clamp()
    assert params.quality == 100
    assert params.dpr > 0
    assert params.max_fps >= 1
    assert params.max_in_flight >= 1
    assert params.settle_scale <= 4.0


# =========================================================================== #
# Part 4 — the engine.  These need PyMOL and a real GL context.
# =========================================================================== #


@pytest.fixture(scope="module")
def render(gl_bridge):
    """THE :class:`RenderService` — the one ``BridgeServer`` already owns.

    This used to build a second service on the same pump.  That worked only
    while ``server.py`` had no render wiring at all; now that it does, two
    services means two :class:`RedisplayGate` s probing one DESTRUCTIVE flag
    (``PyMOL_GetRedisplay``), the first one wins every tick and the second
    never sees a dirty frame — plan §1.2, "exactly one consumer".  So the test
    borrows the product one and only overrides the timings.
    """
    service = gl_bridge.server.render
    assert service.stream.gate.mode in ("pre-tick-hook", "engine-tick-wrapper"), (
        "the server did not attach its render service; gate=%s"
        % service.stream.gate.mode
    )
    events: List[Any] = []
    previous_emit = service.emit
    service.emit = lambda topic, payload: events.append((topic, payload))
    service.events = events  # type: ignore[attr-defined]
    tuned = StreamParams(settle_ms=100.0, ack_timeout_s=0.25)
    saved = (service.stream.params.settle_ms, service.stream.params.ack_timeout_s)
    service.stream.params.settle_ms = tuned.settle_ms
    service.stream.params.ack_timeout_s = tuned.ack_timeout_s
    yield service
    service.stream.params.settle_ms, service.stream.params.ack_timeout_s = saved
    service.emit = previous_emit


def scene(bridge, setup: str, path: Optional[Path] = None, name: str = "m") -> int:
    """Reset PyMOL to a known scene.  Returns the atom count.

    ``cmd.do`` is DEFERRED, not immediate: it goes through ``OrthoCommandIn``
    and is executed by ``PyMOL_Idle`` on a later tick (which is why the
    ``PyMOL>show cartoon`` echoes show up in the test log out of order).  So
    the command lines are queued, the pump is allowed to drain them, and only
    then is the camera set — otherwise ``cmd.orient()`` runs against a scene
    whose reps do not exist yet and the test becomes order-dependent.  That is
    a real bug this helper had, and it made ``cmd.ray`` render 256 unique
    colours instead of several thousand.
    """

    def prepare(engine):
        cmd = engine.cmd
        cmd.delete("all")
        if path is not None:
            cmd.load(str(path), name)
        cmd.hide("everything")
        for line in setup.strip().splitlines():
            cmd.do(line.strip())

    bridge.pump.call(prepare, timeout=300)
    bridge.pump.pump_for(0.3)

    def finish(engine):
        engine.cmd.orient()
        engine.cmd.refresh()
        return engine.cmd.count_atoms("all")

    return bridge.pump.call(finish, timeout=300)


def settle(bridge, seconds: float = 0.6) -> None:
    """Let the pump tick, then sync so the caller knows the ticks happened."""
    bridge.pump.pump_for(seconds)


@pytest.mark.gl
@pytest.mark.engine
def test_the_dirty_gate_probes_before_the_draw(render, gl_bridge):
    """``PyMOL_Draw`` clears ``RedisplayFlag`` (packages/engine/layer5/PyMOL.cpp:2331).

    A post-draw probe therefore reports False for every real change; this test
    is the regression guard for that, and it fails if the gate ever moves back
    into the tick hook.
    """
    assert render.stream.gate.mode in ("pre-tick-hook", "engine-tick-wrapper")
    before = render.stream.gate.dirty_probes
    gl_bridge.pump.call(lambda e: e.cmd.turn("y", 5), timeout=30)
    settle(gl_bridge, 0.15)
    assert render.stream.gate.dirty_probes > before, (
        "a cmd.turn produced no dirty probe -- the gate is running after the "
        "draw again"
    )


@pytest.mark.gl
@pytest.mark.engine
def test_a_static_scene_emits_one_still_and_then_nothing(render, gl_bridge):
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    sink = ListSink("static")
    render.stream.add_client(sink)
    try:
        settle(gl_bridge, 1.0)
        for header in sink.headers():
            render.stream.ack(sink, header["frameId"])
        settle(gl_bridge, 0.5)
        encodings = [h["encoding"] for h in sink.headers()]
        assert encodings, "the first frame after a load must arrive"
        assert encodings[-1] == "png", "a quiet scene must end on a lossless still"

        baseline = len(sink.frames)
        settle(gl_bridge, 1.5)  # ~90 ticks with nothing happening
        assert len(sink.frames) == baseline, (
            "a static scene emitted %d extra frames in 1.5 s -- the stream is "
            "spinning" % (len(sink.frames) - baseline)
        )
    finally:
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_motion_uses_jpeg_and_settling_upgrades_to_lossless_png(render, gl_bridge):
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    sink = ListSink("motion")
    render.stream.add_client(sink)
    try:
        settle(gl_bridge, 0.5)
        for header in sink.headers():
            render.stream.ack(sink, header["frameId"])
        start = len(sink.frames)

        for _ in range(20):
            gl_bridge.pump.call(lambda e: e.cmd.turn("y", 2), timeout=30)
            if len(sink.frames) > start:
                render.stream.ack(sink, sink.headers()[-1]["frameId"])
        # The 0.1 s floor here is exactly settle_ms — on a slow software-GL runner
        # a single dirty tick can take >100 ms, so the motion frame might not land
        # in sink before the settle still fires.  Also, a render failure in a prior
        # test sets a 1 s error-backoff that makes the 100 ms window completely dark.
        # Poll with a deadline scaled by TENMOL_TEST_SLOW (3× on CI) so the wait
        # is proportional to the runner's speed.
        _slow = max(1.0, float(os.environ.get("TENMOL_TEST_SLOW", "1")))
        _motion_deadline = time.monotonic() + _slow * 1.5
        while time.monotonic() < _motion_deadline:
            if any(not h["lossless"] for h in sink.headers()[start:]):
                break
            gl_bridge.pump.pump_for(0.05)
        moving = [h for h in sink.headers()[start:] if not h["lossless"]]
        assert moving, "no lossy frame during motion"
        assert all(h["encoding"] == "jpeg" for h in moving)
        assert all(1 <= h["quality"] <= 100 for h in moving)

        settle(gl_bridge, 0.8)
        for header in sink.headers():
            render.stream.ack(sink, header["frameId"])
        settle(gl_bridge, 0.5)
        last = sink.headers()[-1]
        assert last["lossless"] is True and last["encoding"] == "png"
        assert last["still"] == "settle"
        image = decode_image(sink.decoded()[1])
        assert image.size == gl_bridge.pump.call(
            lambda e: (e.width, e.height), timeout=30
        )
        print(
            "settle still: %s %dx%d %d B, %d unique RGB"
            % (
                last["encoding"],
                image.width,
                image.height,
                last["payloadBytes"],
                unique_rgb(image),
            )
        )
    finally:
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_frames_decode_as_real_renders_not_fills(render, gl_bridge):
    scene(gl_bridge, "show cartoon\nspectrum count, rainbow", PDB_SMALL)
    sink = ListSink("decode")
    render.stream.add_client(sink)
    try:
        settle(gl_bridge, 1.0)
        assert sink.frames
        for header, payload in (sink.decoded(i) for i in range(len(sink.frames))):
            assert header["kind"] == "pixels"
            assert header["payloadBytes"] == len(payload)
            assert sniff_image(bytes(payload)) == header["encoding"]
            image = decode_image(bytes(payload))
            assert image.size == (header["width"], header["height"])
        lossless = [i for i, h in enumerate(sink.headers()) if h["lossless"]]
        assert lossless, "no lossless frame to count colours in"
        image = decode_image(bytes(sink.decoded(lossless[-1])[1]))
        colors = unique_rgb(image)
        assert colors > 1000, "only %d unique RGB values: that is a fill" % colors
        print("lossless still has %d unique RGB values" % colors)
    finally:
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_the_readback_orientation_matches_pymols_own_png(render, gl_bridge):
    """Compare our flipped readback with ``cmd.png``, which is known-correct.

    An unflipped stream looks perfectly plausible on screen until you notice
    the molecule is upside down, so this is checked against PyMOL's own writer
    rather than by eye.
    """
    from PIL import Image
    import io

    scene(gl_bridge, "show cartoon\nspectrum count, rainbow", PDB_SMALL)
    sink = ListSink("orient")
    render.stream.add_client(sink)
    try:
        settle(gl_bridge, 1.0)
        lossless = [i for i, h in enumerate(sink.headers()) if h["lossless"]]
        assert lossless, "need a lossless frame for a pixel comparison"
        mine = decode_image(bytes(sink.decoded(lossless[-1])[1])).convert("RGB")

        reference_bytes = gl_bridge.pump.call(
            lambda e: e.cmd.png(None, prior=0, ray=1, quiet=1), timeout=300
        )
        theirs = Image.open(io.BytesIO(reference_bytes)).convert("RGB")
        assert theirs.size == mine.size

        # Ray tracing is not pixel-identical to the GL render, so compare the
        # vertical CENTRE OF MASS of non-background pixels: an unflipped frame
        # puts it on the wrong side of the image.
        def centroid_y(image) -> float:
            small = image.resize((64, 64))
            background = small.getpixel((0, 0))
            total = 0.0
            weight = 0.0
            for y in range(64):
                for x in range(64):
                    pixel = small.getpixel((x, y))
                    delta = sum(abs(a - b) for a, b in zip(pixel, background))
                    if delta > 40:
                        total += y
                        weight += 1
            return total / max(1.0, weight)

        ours, reference = centroid_y(mine), centroid_y(theirs)
        print("centroid row: stream %.1f, cmd.png(ray=1) %.1f" % (ours, reference))
        assert abs(ours - reference) < 12, (
            "the stream is vertically mirrored relative to cmd.png "
            "(%.1f vs %.1f)" % (ours, reference)
        )
    finally:
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_backpressure_drops_frames_and_never_grows_a_queue(render, gl_bridge):
    """A client that never acks must not accumulate an unbounded backlog."""
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    render.stream.params.ack_timeout_s = 1e6  # this client will never be released
    slow = ListSink("slow")
    render.stream.add_client(slow)
    try:
        settle(gl_bridge, 0.3)
        baseline = len(slow.frames)
        skipped_before = render.stream.frames_skipped
        for _ in range(40):
            gl_bridge.pump.call(lambda e: e.cmd.turn("y", 3), timeout=30)
        settle(gl_bridge, 0.5)
        grew = len(slow.frames) - baseline
        assert grew <= 1, (
            "a non-acking client received %d frames: the bridge is queueing, "
            "not dropping" % grew
        )
        assert render.stream.frames_skipped > skipped_before
        assert render.stream.quality.quality < render.stream.quality.base, (
            "sustained backpressure must walk the JPEG quality down"
        )
        print(
            "backpressure: %d frames skipped, quality %d -> %d"
            % (
                render.stream.frames_skipped - skipped_before,
                render.stream.quality.base,
                render.stream.quality.quality,
            )
        )
    finally:
        render.stream.remove_client(slow)
        render.stream.params.ack_timeout_s = 0.25
        render.stream.quality.reset()


@pytest.mark.gl
@pytest.mark.engine
def test_pause_and_resume(render, gl_bridge):
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    sink = ListSink("pause")
    render.stream.add_client(sink)
    try:
        settle(gl_bridge, 0.4)
        render.stream.set_params(paused=True)
        settle(gl_bridge, 0.2)
        baseline = len(sink.frames)
        for _ in range(10):
            gl_bridge.pump.call(lambda e: e.cmd.turn("y", 5), timeout=30)
        settle(gl_bridge, 0.4)
        assert len(sink.frames) == baseline, "a paused stream still emitted"

        render.stream.set_params(paused=False)
        settle(gl_bridge, 0.5)
        assert len(sink.frames) > baseline, "resuming did not produce a frame"
    finally:
        render.stream.set_params(paused=False)
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_settle_scale_renders_the_still_at_device_pixel_ratio(render, gl_bridge):
    """Plan §1.3: "CSS pixels during motion, devicePixelRatio on settle".

    The FBO is resized up, drawn, read back and resized straight back down, and
    the redisplay the restore causes is swallowed so the still cannot retrigger
    itself into a loop.
    """
    scene(gl_bridge, "show cartoon\nspectrum count, rainbow", PDB_SMALL)
    base = gl_bridge.pump.call(lambda e: (e.width, e.height), timeout=30)
    sink = ListSink("dpr")
    render.stream.add_client(sink)
    try:
        render.stream.set_params(settleScale=2.0, dpr=2.0)
        settle(gl_bridge, 1.2)
        for header in sink.headers():
            render.stream.ack(sink, header["frameId"])
        settle(gl_bridge, 0.8)

        stills = [h for h in sink.headers() if h.get("still") == "settle"]
        assert stills, "no settle still at all"
        big = stills[-1]
        assert (big["width"], big["height"]) == (base[0] * 2, base[1] * 2), (
            "the settle still is %dx%d, expected 2x of %r"
            % (big["width"], big["height"], base)
        )
        assert big["dpr"] == 2.0 and big["lossless"] is True
        index = sink.headers().index(big)
        image = decode_image(bytes(sink.decoded(index)[1]))
        assert image.size == (base[0] * 2, base[1] * 2)
        assert unique_rgb(image) > 1000

        # ... and the viewport went straight back, so the next drag is cheap.
        assert gl_bridge.pump.call(lambda e: (e.width, e.height), timeout=30) == base
        assert render.stream.last_error is None
        print(
            "settle at dpr 2: %dx%d %d B (motion frames stay %dx%d)"
            % (image.width, image.height, big["payloadBytes"], base[0], base[1])
        )
    finally:
        render.stream.set_params(settleScale=1.0, dpr=1.0)
        render.stream.remove_client(sink)
        settle(gl_bridge, 0.3)


@pytest.mark.gl
@pytest.mark.engine
def test_cmd_ray_is_an_explicit_high_quality_still(render, gl_bridge):
    # Colour the scene EXPLICITLY.  `cmd.load` takes the next entry from
    # PyMOL's auto_color cycle, so an object's default colour depends on how
    # many objects the process has loaded before -- and one of the entries is a
    # light grey, which renders as 256 unique RGB values however good the
    # picture is.  That made this assertion pass in isolation and fail in the
    # full suite; the fix is to stop depending on the cycle.
    scene(gl_bridge, "show cartoon\nspectrum count, rainbow", PDB_SMALL)
    sink = ListSink("ray")
    render.stream.add_client(sink)
    try:
        settle(gl_bridge, 0.4)
        result = render.route(
            "_bridge.ray", kwargs={"width": 640, "height": 480}
        ).result(300)
        assert result["bytes"] > 0
        header, payload = sink.decoded()
        assert header["still"] == "ray"
        assert header["encoding"] == "png" and header["lossless"] is True
        assert header["flipY"] is False, "ScenePNG already writes top-down"
        assert sniff_image(bytes(payload)) == "png"
        image = decode_image(bytes(payload))
        assert image.size == (640, 480)
        assert unique_rgb(image) > 1000
        print(
            "ray 640x480: %.3f s ray + %.1f ms png = %d B, %d unique RGB"
            % (
                result["rayMs"] / 1000.0,
                result["pngMs"],
                result["bytes"],
                unique_rgb(image),
            )
        )
    finally:
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_resize_reaches_pymol_and_the_next_frame_matches(render, gl_bridge):
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    sink = ListSink("resize")
    render.stream.add_client(sink)
    original = gl_bridge.pump.call(lambda e: (e.width, e.height), timeout=30)
    try:
        render.route("_bridge.set_pixel_stream", kwargs={"width": 640, "height": 400})
        settle(gl_bridge, 0.6)
        header, _payload = sink.decoded()
        assert (header["width"], header["height"]) == (640, 400)
        viewport = gl_bridge.pump.call(lambda e: e.cmd.get_viewport(), timeout=30)
        assert tuple(viewport) == (640, 400), (
            "PyMOL's viewport did not follow the framebuffer: %r" % (viewport,)
        )
    finally:
        render.route(
            "_bridge.set_pixel_stream",
            kwargs={"width": original[0], "height": original[1]},
        )
        settle(gl_bridge, 0.4)
        render.stream.remove_client(sink)


@pytest.mark.gl
@pytest.mark.engine
def test_ack_message_routing(render, gl_bridge):
    sink = ListSink("ack")
    render.add_client(sink)
    try:
        settle(gl_bridge, 0.4)
        assert sink.frames
        frame_id = sink.headers()[-1]["frameId"]
        assert render.handle_client_message(sink, {"t": "ack", "frameId": frame_id})
        assert render.handle_client_message(sink, {"t": "ping"}) is False
        assert render.stream.subscriber(sink).last_acked == frame_id
    finally:
        render.remove_client(sink)


# --------------------------------------------------------------------------- #
# THE ACCEPTANCE BENCHMARK
# --------------------------------------------------------------------------- #


@pytest.mark.gl
@pytest.mark.engine
def test_benchmark_1aon_at_1280x960(render, gl_bridge):
    """Plan §6 WP-04: 1AON, 100 ``turn``+frame cycles, median <= 6 ms."""
    if not PDB_1AON.exists():
        pytest.skip("packages/engine/testing/data/1aon.pdb.gz is not in this tree")

    original = gl_bridge.pump.call(lambda e: (e.width, e.height), timeout=30)
    gl_bridge.pump.call(lambda e: e.resize(BENCH_W, BENCH_H), timeout=60)
    atoms = scene(gl_bridge, "show cartoon", PDB_1AON, name="bench")
    assert atoms > 50000, "expected 1AON's 58,870 atoms, got %d" % atoms

    stream = render.stream
    stream.params.max_fps = 240.0
    stream.quality.reset()
    sink = ListSink("bench")
    stream.add_client(sink)

    # Ack on the ENGINE thread, right after the frame was queued: a zero-RTT
    # client.  Acking from the harness thread instead makes the harness's own
    # scheduling latency show up as frame skips, which drags the adaptive
    # quality below q80 and makes KB/frame incomparable with the plan's table.
    # Real flow control is measured separately, in the backpressure test.
    def zero_rtt_ack(_engine: Any) -> None:
        if sink.last_frame_id:
            stream.ack(sink, sink.last_frame_id)

    gl_bridge.pump.add_tick_hook(zero_rtt_ack)
    settle(gl_bridge, 0.5)
    sink.frames.clear()
    stream._samples.clear()
    skipped_before = stream.frames_skipped

    try:
        # Drive the real path: a client command, a real tick, a real frame,
        # and an ack, 100 times.
        emitted_before = stream.frames_emitted
        wall0 = time.perf_counter()
        cycles = 0
        deadline = time.monotonic() + 60.0
        while stream.frames_emitted - emitted_before < 100:
            if time.monotonic() > deadline:
                break
            gl_bridge.pump.call(lambda e: e.cmd.turn("y", 1), timeout=30)
            cycles += 1
            time.sleep(0.001)
        wall = time.perf_counter() - wall0

        timings = stream.timings()
        frames = stream.frames_emitted - emitted_before
        print(
            "\n".join(
                (
                    "",
                    "=== WP-04 ACCEPTANCE: 1AON (%d atoms) cartoon @ %dx%d ==="
                    % (atoms, BENCH_W, BENCH_H),
                    "  frames emitted        : %d over %d turn cycles in %.2f s"
                    % (frames, cycles, wall),
                    "  readback  ms (median) : %.3f" % timings["readbackMsMedian"],
                    "  encode    ms (median) : %.3f" % timings["encodeMsMedian"],
                    "  FULL FRAME ms (median): %.3f   (p95 %.3f)"
                    % (timings["frameMsMedian"], timings["frameMsP95"]),
                    "  KB/frame     (median) : %.1f   (p95 %.1f)"
                    % (timings["kbMedian"], timings["kbP95"]),
                    "  effective quality     : %d (ceiling %d)"
                    % (stream.quality.quality, stream.quality.base),
                    "  frames skipped        : %d"
                    % (stream.frames_skipped - skipped_before),
                    "  implied fps           : %.0f"
                    % (1000.0 / max(0.001, timings["frameMsMedian"])),
                    "  implied MB/s at 30 fps: %.1f"
                    % (timings["kbMedian"] * 30 / 1024.0),
                    "  JSON: " + json.dumps(timings, sort_keys=True),
                )
            )
        )

        assert timings["samples"] >= 50, "only %d samples" % timings["samples"]
        assert timings["frameMsMedian"] <= 6.0, (
            "median end-to-end frame time %.3f ms exceeds the 6 ms budget"
            % timings["frameMsMedian"]
        )

        # ... and the frames are real images, not fills.
        header, payload = sink.decoded()
        image = decode_image(bytes(payload))
        assert image.size == (BENCH_W, BENCH_H)
        colors = unique_rgb(image)
        print("  unique RGB in last frame: %d" % colors)
        assert colors > 1000, "%d unique RGB values is a fill, not a render" % colors
    finally:
        gl_bridge.pump.remove_tick_hook(zero_rtt_ack)
        stream.remove_client(sink)
        stream.params.max_fps = 60.0
        gl_bridge.pump.call(lambda e: e.resize(*original), timeout=60)
        settle(gl_bridge, 0.3)


@pytest.mark.gl
@pytest.mark.engine
def test_benchmark_raw_pipeline_stages(render, gl_bridge):
    """The plan §1.3 table, stage by stage, with no flow control in the way.

    ``turn`` + ``p.draw`` + ``glReadPixels`` + JPEG q80 at 1280x960 on 1AON.
    Reported so the three numbers can be compared directly with the plan's
    0.5 / 1.0 / 1.9 ms and 209,186 B.
    """
    if not PDB_1AON.exists():
        pytest.skip("packages/engine/testing/data/1aon.pdb.gz is not in this tree")

    original = gl_bridge.pump.call(lambda e: (e.width, e.height), timeout=30)
    gl_bridge.pump.call(lambda e: e.resize(BENCH_W, BENCH_H), timeout=60)
    atoms = scene(gl_bridge, "show cartoon", PDB_1AON, name="bench")
    readback = render.stream._readback
    assert readback is not None, "the stream never read the framebuffer back"

    def bench(engine) -> Dict[str, Any]:
        draw: List[float] = []
        read: List[float] = []
        enc: List[float] = []
        sizes: List[int] = []
        png: List[float] = []
        png_sizes: List[int] = []
        for index in range(80):
            t0 = time.perf_counter()
            engine.cmd.turn("y", 1)
            engine.p.draw()
            t1 = time.perf_counter()
            buf, read_ms = readback.read(BENCH_W, BENCH_H)
            image = encode_rgba(buf, BENCH_W, BENCH_H, "jpeg", quality=80)
            draw.append((t1 - t0) * 1000.0)
            read.append(read_ms)
            enc.append(image.encode_ms)
            sizes.append(len(image.data))
            if index % 20 == 0:
                still = encode_rgba(buf, BENCH_W, BENCH_H, "png")
                png.append(still.encode_ms)
                png_sizes.append(len(still.data))

        def median(values):
            values = sorted(values)
            return values[len(values) // 2]

        return {
            "drawMs": median(draw),
            "readMs": median(read),
            "jpegMs": median(enc),
            "jpegBytes": median(sizes),
            "pngMs": median(png),
            "pngBytes": median(png_sizes),
            "totalMs": median(draw) + median(read) + median(enc),
        }

    try:
        result = gl_bridge.pump.call(bench, timeout=300)
        # One write, with a leading newline: PyMOL's own busy/progress output
        # is \r-terminated and will happily overwrite a line printed here.
        print(
            "\n".join(
                (
                    "",
                    "=== RAW PIPELINE, 1AON (%d atoms) cartoon @ %dx%d, JPEG q80 ==="
                    % (atoms, BENCH_W, BENCH_H),
                    "  cmd.turn + p.draw     : %.3f ms   (plan: 0.5)"
                    % result["drawMs"],
                    "  + glReadPixels RGBA   : %.3f ms   (plan: 1.0)"
                    % result["readMs"],
                    "      (p.draw returns before the GPU is done; glReadPixels is",
                    "       where the sync actually lands, so read the two together:",
                    "       draw+readback = %.3f ms)"
                    % (result["drawMs"] + result["readMs"]),
                    "  + JPEG q80 encode     : %.3f ms -> %d B   (plan: 1.9 / 209,186)"
                    % (result["jpegMs"], result["jpegBytes"]),
                    "  FULL FRAME            : %.3f ms = %.0f fps   (plan: 3.4 / 290)"
                    % (result["totalMs"], 1000.0 / result["totalMs"]),
                    "  PNG L1 (settle)       : %.3f ms -> %d B   (plan: 10.5 / 746,205)"
                    % (result["pngMs"], result["pngBytes"]),
                    "  JSON: " + json.dumps(result, sort_keys=True),
                    "",
                )
            )
        )
        assert result["totalMs"] <= 6.0
        assert result["jpegBytes"] > 10000, "a 10 KB JPEG of 1AON is a blank frame"
    finally:
        gl_bridge.pump.call(lambda e: e.resize(*original), timeout=60)
        settle(gl_bridge, 0.3)


# =========================================================================== #
# Part 5 — Mode G: the C++ geometry accessor over the wire
# =========================================================================== #


@pytest.mark.gl
@pytest.mark.engine
def test_mode_g_reports_whether_the_accessor_landed(render, gl_bridge):
    caps = render.geometry.capabilities(gl_bridge.pump.engine)
    print("Mode G capabilities:", json.dumps(caps, sort_keys=True))
    assert caps["symbol"] == "_cmd.web_get_rep_geometry"
    # plan §4 task 6 (ReprVersion counters) landed in the wave-2 native work:
    # _cmd.web_get_versions exposes exact per-(object, rep, state) versions, so
    # the bridge is now entitled to claim exact invalidation. If this build has
    # no counters the bridge must fall back and say so.
    if caps["exactInvalidation"]:
        assert caps["invalidationSources"][0] == "rep-version-counters", (
            "exactInvalidation is claimed but the first source is not the "
            f"counters: {caps['invalidationSources']!r}"
        )
        assert caps.get("versionSymbol") == "_cmd.web_get_versions"
    else:
        assert "rep-version-counters" not in caps["invalidationSources"]
    if not caps["accessor"]:
        pytest.skip("this PyMOL build has no web_get_rep_geometry (WP-26)")


def fetch(render, bridge, obj: str, rep: str, state: int = -1, have=None):
    return bridge.pump.call(
        lambda engine: render.geometry.fetch(engine, obj, rep, state=state, have=have),
        timeout=300,
    )


def refs_of(header: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if header["kind"] == "indexed-mesh":
        out.extend(header["buffers"].values())
    else:
        out.extend(block["data"] for block in header["blocks"])
        for instance in header["instances"]:
            out.append(instance["data"])
            for key in ("atom", "bond", "atom2"):
                if instance.get(key):
                    out.append(instance[key])
    return out


def assert_frame_is_sane(result, payload_kind: str):
    """The Python half of ``geometryFrameProblems()`` from geometry.ts."""
    assert result.ok, "%s: %s" % (result.status, result.message)
    header, payload = decode_binary_frame(result.frame)
    assert header["kind"] == payload_kind
    assert header["payloadBytes"] == len(payload)
    assert header["v"] == 1
    for ref in refs_of(header):
        assert ref["dtype"] in ("f32", "i32", "u32", "u8")
        size = {"f32": 4, "i32": 4, "u32": 4, "u8": 1}[ref["dtype"]]
        assert ref["byteLength"] % size == 0
        if size > 1:
            assert ref["byteOffset"] % 4 == 0, (
                "byteOffset %d is not 4-aligned; viewOf() would memcpy"
                % ref["byteOffset"]
            )
        assert ref["byteOffset"] + ref["byteLength"] <= len(payload)
        elements = ref["byteLength"] // size
        if ref["itemSize"] > 0:
            assert elements % ref["itemSize"] == 0
    return header, payload


@pytest.mark.gl
@pytest.mark.engine
def test_surface_arrives_as_an_indexed_mesh_with_atom_indices(render, gl_bridge):
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show surface", PDB_SMALL)
    result = fetch(render, gl_bridge, "m", "surface")
    header, payload = assert_frame_is_sane(result, "indexed-mesh")

    assert header["counts"]["verts"] > 0 and header["counts"]["tris"] > 0
    buffers = header["buffers"]
    assert "position" in buffers and "index" in buffers
    assert "atom" in buffers, (
        "RepSurface::AT is the ONLY per-vertex atom mapping PyMOL has and no "
        "exporter carries it; dropping it makes picking impossible"
    )
    verts = header["counts"]["verts"]
    assert buffers["position"]["byteLength"] == verts * 3 * 4
    assert buffers["index"]["byteLength"] == header["counts"]["tris"] * 3 * 4
    assert buffers["color"] or header["oneColor"] is not None

    # atom indices must be in range
    import array

    atoms = array.array("i")
    atoms.frombytes(
        bytes(
            payload[
                buffers["atom"]["byteOffset"] : buffers["atom"]["byteOffset"]
                + buffers["atom"]["byteLength"]
            ]
        )
    )
    n_atom = gl_bridge.pump.call(lambda e: e.cmd.count_atoms("m"), timeout=30)
    assert min(atoms) >= -1 and max(atoms) < n_atom
    print(
        "surface: %d verts / %d tris / %d B frame, atom range %d..%d"
        % (verts, header["counts"]["tris"], result.nbytes, min(atoms), max(atoms))
    )


@pytest.mark.gl
@pytest.mark.engine
def test_sticks_arrive_as_cylinder_instances_never_tessellated(render, gl_bridge):
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show sticks", PDB_SMALL)
    result = fetch(render, gl_bridge, "m", "sticks")
    header, _payload = assert_frame_is_sane(result, "cgo-draw-arrays")

    kinds = {instance["kind"] for instance in header["instances"]}
    assert "cylinder2" in kinds, "sticks were tessellated into triangles"
    for instance in header["instances"]:
        item = modeg.INSTANCE_ITEM_SIZE[instance["kind"]]
        assert instance["itemSize"] == item
        assert instance["data"]["byteLength"] == instance["count"] * item * 4
        assert instance.get("atom"), "no per-instance atom index: picking is dead"
        assert instance["atom"]["byteLength"] == instance["count"] * 4
    print(
        "sticks: %s, %d B frame"
        % (
            {i["kind"]: i["count"] for i in header["instances"]},
            result.nbytes,
        )
    )


@pytest.mark.gl
@pytest.mark.engine
def test_instanced_only_reps_carry_instances(render, gl_bridge):
    """``INSTANCED_ONLY_REPS`` in geometry.ts: spheres/nb_spheres/dots/ellipsoids
    must never come back as triangles."""
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show spheres\nshow dots", PDB_SMALL)
    for rep in ("spheres", "dots"):
        result = fetch(render, gl_bridge, "m", rep)
        if result.status != "ok":
            print("%-10s %s: %s" % (rep, result.status, result.message))
            continue
        header, _payload = assert_frame_is_sane(result, "cgo-draw-arrays")
        assert header["instances"], (
            "%s carries no instance buffer -- it has been TESSELLATED, which "
            "is the exporter failure plan §1.3 constraint 1 forbids" % rep
        )
        print(
            "%-10s %s %d B"
            % (
                rep,
                {i["kind"]: i["count"] for i in header["instances"]},
                result.nbytes,
            )
        )


@pytest.mark.gl
@pytest.mark.engine
def test_cartoon_draw_arrays_blocks_have_the_verbatim_c_layout(render, gl_bridge):
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    result = fetch(render, gl_bridge, "m", "cartoon")
    header, _payload = assert_frame_is_sane(result, "cgo-draw-arrays")
    assert header["blocks"], "cartoon produced no draw-arrays blocks"

    def narrays(bits: int) -> int:
        total = 3
        if bits & modeg.BIT_NORMAL:
            total += 3
        if bits & modeg.BIT_COLOR:
            total += 4
        if bits & modeg.BIT_PICK:
            total += 1 + 2
        if bits & modeg.BIT_ACCESS:
            total += 1
        return total

    verts = 0
    for block in header["blocks"]:
        assert 0 <= block["mode"] <= 6, "not a legal CGO_BEGIN mode"
        expect = narrays(block["arraybits"]) * block["nverts"] * 4
        assert block["data"]["byteLength"] == expect, (
            "block data is %d B, narrays(%d)*nverts(%d)*4 = %d -- the layout "
            "does not match cgoArraysLayout()"
            % (block["data"]["byteLength"], block["arraybits"], block["nverts"], expect)
        )
        verts += block["nverts"]
    print("cartoon: %d blocks / %d verts / %d B frame"
          % (len(header["blocks"]), verts, result.nbytes))


@pytest.mark.gl
@pytest.mark.engine
def test_an_unchanged_rep_is_not_re_shipped(render, gl_bridge):
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    first = fetch(render, gl_bridge, "m", "cartoon")
    assert first.ok and first.content_hash

    again = fetch(render, gl_bridge, "m", "cartoon", have=first.content_hash)
    assert again.status == "unchanged"
    assert again.frame is None, "an unchanged rep must not put bytes on the wire"
    assert again.content_hash == first.content_hash

    gl_bridge.pump.call(lambda e: e.cmd.color("red", "m"), timeout=60)
    gl_bridge.pump.call(lambda e: e.cmd.refresh(), timeout=60)
    recoloured = fetch(render, gl_bridge, "m", "cartoon", have=first.content_hash)
    assert recoloured.status == "ok"
    assert recoloured.content_hash != first.content_hash
    print(
        "cartoon hash %s -> %s after cmd.color"
        % (first.content_hash[:12], recoloured.content_hash[:12])
    )


@pytest.mark.gl
@pytest.mark.engine
def test_geometry_status_vocabulary_is_honest(render, gl_bridge):
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show cartoon", PDB_SMALL)

    not_built = fetch(render, gl_bridge, "m", "surface")
    assert not_built.status in ("not-built", "empty"), not_built.status
    assert not_built.frame is None

    labels = fetch(render, gl_bridge, "m", "labels")
    assert labels.status in ("unsupported", "not-built", "empty")
    if labels.status == "unsupported":
        assert labels.fallback == "unsupported-rep", (
            "a rep Mode G cannot serve must name a fallback reason, not go quiet"
        )

    missing = fetch(render, gl_bridge, "nosuchobject", "cartoon")
    assert missing.status == "unsupported"
    print(
        "statuses: surface=%s labels=%s(%s) missing=%s"
        % (not_built.status, labels.status, labels.fallback, missing.status)
    )


@pytest.mark.gl
@pytest.mark.engine
def test_invalidation_names_the_keys_the_client_must_refetch(render, gl_bridge):
    if not render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]:
        pytest.skip("no accessor")
    scene(gl_bridge, "show cartoon", PDB_SMALL)
    fetch(render, gl_bridge, "m", "cartoon")

    invalidated = render.geometry.invalidate(objects=["m"], level=modeg.RepInv.COLOR)
    assert invalidated, "nothing invalidated for an object we just cached"
    assert all(entry["object"] == "m" for entry in invalidated)
    cartoon = [e for e in invalidated if e["rep"] == rep_id("cartoon")]
    assert cartoon, "the rep we just cached was not invalidated: %r" % (invalidated,)
    entry = cartoon[0]
    assert entry["level"] == modeg.RepInv.COLOR
    assert entry["estimatedBytes"] > 0
    assert render.geometry.dirty_keys()

    # The fingerprint scan catches show/hide without any command echo.
    gl_bridge.pump.call(lambda e: render.geometry.scan(e), timeout=60)
    gl_bridge.pump.call(lambda e: e.cmd.show("lines", "m"), timeout=60)
    changed = gl_bridge.pump.call(lambda e: render.geometry.scan(e), timeout=60)
    assert changed, "cmd.show did not move the visibility fingerprint"
    print("invalidation: %r" % (changed[0],))


@pytest.mark.gl
@pytest.mark.engine
def test_render_mode_policy_falls_back_and_says_why(render, gl_bridge):
    result = render.set_render_mode(default="geometry")
    by_name = {entry["name"]: entry for entry in result["modes"]}
    accessor = render.geometry.capabilities(gl_bridge.pump.engine)["accessor"]

    assert by_name["labels"]["effective"] == "pixel"
    assert by_name["labels"]["fallbackReason"] in (
        "unsupported-rep",
        "no-accessor",
    )
    assert by_name["volume"]["effective"] == "pixel"
    if accessor:
        assert by_name["cartoon"]["effective"] == "geometry"
        assert by_name["surface"]["effective"] == "geometry"

    pinned = render.set_render_mode(perRep=[{"rep": "cartoon", "requested": "pixel"}])
    assert {e["name"]: e for e in pinned["modes"]}["cartoon"]["effective"] == "pixel"
    render.set_render_mode(default="pixel")
    print(
        "mode G reps: %s"
        % sorted(e["name"] for e in result["modes"] if e["effective"] == "geometry")
    )


@pytest.mark.gl
@pytest.mark.engine
def test_render_stats_are_json_serialisable(render, gl_bridge):
    stats = render.route("_bridge.render_stats")
    text = json.dumps(stats)
    assert '"modeP"' in text and '"modeG"' in text
    assert stats["modeP"]["gate"]["mode"] in ("pre-tick-hook", "engine-tick-wrapper")
    assert stats["modeP"]["headerAlignment"] == 4
    assert math.isfinite(stats["uptimeS"])


# =========================================================================== #
# Part 6 — over the REAL WebSocket
# =========================================================================== #


@pytest.mark.gl
@pytest.mark.engine
def test_a_real_websocket_client_receives_decodable_binary_frames(render, gl_bridge):
    """End to end through uvicorn, ``ClientSession`` and a real socket.

    Everything above drives the stream with a list-backed stub; this drives it
    with the object the product actually uses, so a mistake in the
    ``send_soon`` contract or in the binary framing cannot hide.
    """
    from websockets.sync.client import connect

    scene(gl_bridge, "show cartoon\nspectrum count, rainbow", PDB_SMALL)
    server = gl_bridge.app.state.server
    before = list(server.sessions)
    conn = connect(gl_bridge.ws_url, open_timeout=20)
    try:
        deadline = time.monotonic() + 20.0
        session = None
        while time.monotonic() < deadline:
            new = [s for s in server.sessions if s not in before]
            if new:
                session = new[-1]
                break
            time.sleep(0.05)
        assert session is not None, "the server never registered the connection"

        # THE PRODUCT PATH: `{t:'sub', topic:'pixels'}` is what registers the
        # Mode-P sink now (server.py routes sub -> RenderService.add_client).
        # No hand wiring.
        import json as _json

        conn.send(_json.dumps({"id": 9000, "t": "sub", "topic": "pixels"}))
        deadline = time.monotonic() + 10.0
        subscribed = False
        while time.monotonic() < deadline and not subscribed:
            try:
                raw = conn.recv(timeout=1.0)
            except TimeoutError:
                continue
            if isinstance(raw, (bytes, bytearray)):
                continue
            frame = _json.loads(raw)
            if frame.get("id") == 9000:
                assert frame["t"] == "ok", frame
                subscribed = True
        assert subscribed, "the server never acknowledged sub:pixels"
        render.stream.request_frame()

        binaries: List[bytes] = []
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline and len(binaries) < 2:
            try:
                raw = conn.recv(timeout=2.0)
            except TimeoutError:
                continue
            if isinstance(raw, (bytes, bytearray)):
                binaries.append(bytes(raw))
                header, _payload = decode_binary_frame(bytes(raw))
                render.stream.ack(session, header["frameId"])
                gl_bridge.pump.call(lambda e: e.cmd.turn("y", 4), timeout=30)

        assert binaries, "no binary frame reached a real WebSocket client"
        for raw in binaries:
            header, payload = decode_binary_frame(raw)
            assert header["kind"] == "pixels"
            assert header["payloadBytes"] == len(payload)
            assert sniff_image(bytes(payload)) == header["encoding"]
            image = decode_image(bytes(payload))
            assert image.size == (header["width"], header["height"])
        print(
            "over a real socket: %d frames, %s"
            % (
                len(binaries),
                [
                    (h["encoding"], h["payloadBytes"])
                    for h in (decode_binary_frame(r)[0] for r in binaries)
                ],
            )
        )

        # And prove the wiring gap is CLOSED: the server understands t:'ack'.
        # It replies with nothing at all (an ack that produced an ok frame
        # would double the traffic it exists to bound), so the assertion is
        # "no err frame came back", plus the stream counted the ack.
        def sub_stats():
            subs = render.stream.stats()["subscribers"]
            assert subs, "the subscribed session is not a Mode-P client"
            return list(subs.values())[0]

        acks_before = sub_stats()["acks"]
        last_sent = sub_stats()["lastSent"]
        conn.send(
            _json.dumps(
                {"id": 9001, "t": "ack", "what": "pixels", "frameId": last_sent}
            )
        )
        reply = None
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline and reply is None:
            try:
                raw = conn.recv(timeout=0.5)
            except TimeoutError:
                continue
            if isinstance(raw, (bytes, bytearray)):
                continue
            frame = _json.loads(raw)
            if frame.get("id") == 9001:
                reply = frame
        print(
            "server reply to t:'ack': %r (acks %d -> %d)"
            % (reply, acks_before, sub_stats()["acks"])
        )
        assert reply is None, (
            "t:'ack' should be consumed silently, not answered with %r" % (reply,)
        )
    finally:
        if session is not None:
            render.remove_client(session)
        conn.close()
