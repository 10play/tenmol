"""Policy, codec, blobs, framing and dispatch.

Most of this file needs no engine: the policy and the codec are pure data plus a
resolver, and they are the two places where a mistake is silent (a symbol that
should be reachable but is not; a return value that becomes ``repr()`` instead
of an error).  The handful of tests that do need PyMOL reuse the one
session-scoped bridge from ``conftest.py``.
"""

from __future__ import annotations

import base64
import json
import struct

import pytest

from tenmol_bridge import codec, errors, incentive_only, session
from tenmol_bridge.blobs import BlobNotFound, BlobStore
from tenmol_bridge.policy import Grant, Policy, build_policy


# ----------------------------------------------------------------- policy


@pytest.fixture
def policy() -> Policy:
    return build_policy()


@pytest.mark.parametrize(
    "symbol",
    [
        # plain API
        "fragment",
        "get_view",
        "cmd.load",
        "cmd.get_names",
        # the six features the old deny-list broke (plan §A6)
        "system",
        "run",
        "cd",
        "spawn",
        "_ctrl",
        "_alt",
        "_ctsh",
        # namespaces the UI needs
        "util.cbc",
        "editor.attach_fragment",
        "preset.pretty",
        "movie.produce",
        "menu.mol_show",
        "plugins.get_startup_path",
    ],
)
def test_symbols_the_ui_needs_are_allowed(policy: Policy, symbol: str) -> None:
    decision = policy.check(symbol)
    assert decision.allowed, (symbol, decision.reason)


def test_system_needs_one_confirmation_then_flows(policy: Policy) -> None:
    first = policy.check("system")
    assert first.allowed and first.needs_confirmation
    with pytest.raises(errors.NotAllowed):
        first.raise_if_denied()
    policy.confirm("system")
    second = policy.check("system")
    assert second.allowed and not second.needs_confirmation
    second.raise_if_denied()


def test_quit_is_routed_not_executed(policy: Policy) -> None:
    for symbol in ("quit", "_quit"):
        decision = policy.check(symbol)
        assert decision.allowed
        assert decision.routed, symbol


@pytest.mark.parametrize(
    "symbol,why",
    [
        ("__class__", "dunder"),
        ("cmd.__globals__", "dunder"),
        ("a.b.c.d", "too many segments"),
        ("cmd.load; rm -rf /", "not an identifier"),
        ("", "empty"),
        (None, "not a string"),
        (42, "not a string"),
        ("os.system", "unknown namespace"),
        ("subprocess.run", "unknown namespace"),
        ("_secret", "ungranted private"),
    ],
)
def test_shape_and_namespace_rules(policy: Policy, symbol, why: str) -> None:
    assert not policy.check(symbol).allowed, (symbol, why)


@pytest.mark.parametrize(
    "symbol", ["_get_feedback", "cmd._get_feedback", "get_setting_updates"]
)
def test_the_destructive_drains_are_exclusive_to_the_bridge(
    policy: Policy, symbol: str
) -> None:
    """Plan §1.2: two interleaved consumers gave A=[468 lines], B=[]."""
    decision = policy.check(symbol)
    assert not decision.allowed
    assert "exclusiv" in decision.reason


def test_dangerous_symbols_are_marked_not_hidden(policy: Policy) -> None:
    for symbol in ("run", "load", "alter", "iterate", "set_key"):
        decision = policy.check(symbol)
        assert decision.allowed and decision.dangerous, symbol
        assert decision.danger_reason


def test_paranoid_deployment_can_refuse_dangerous() -> None:
    strict = build_policy(allow_dangerous=False)
    assert not strict.check("system").allowed
    assert strict.check("get_view").allowed


def test_invalidation_classes_ride_along(policy: Policy) -> None:
    assert policy.check("color").invalidates == ("color",)
    assert policy.check("show").invalidates == ("reps",)
    assert "resync" in policy.check("run").invalidates
    assert policy.check("get_view").invalidates == ()


def test_grants_merge_without_touching_a_shared_file() -> None:
    """Plan §5.2: each WP drops policy/grants/wp-NN.py; nobody edits a list."""
    policy = build_policy()
    assert not policy.check("nonesuch.thing").allowed
    policy.add_grant(
        Grant(
            wp="WP-99",
            roots={"nonesuch"},
            invalidates={"thing": ("names",)},
            dangerous={"thing": "test"},
        )
    )
    decision = policy.check("nonesuch.thing")
    assert decision.allowed
    assert decision.invalidates == ("names",)
    assert decision.dangerous


# ------------------------------------------------------------------ codec


def test_scalars_and_containers_round_trip() -> None:
    value = {"a": [1, 2.5, "x", True, None], "b": (3, 4)}
    assert codec.encode(value) == {"a": [1, 2.5, "x", True, None], "b": [3, 4]}


def test_non_finite_floats_become_null_not_invalid_json() -> None:
    encoded = codec.encode([float("nan"), float("inf"), -float("inf"), 1.5])
    assert encoded == [None, None, None, 1.5]
    json.dumps(encoded)  # must not raise


def test_numpy_arrays_are_copied_and_shaped() -> None:
    numpy = pytest.importorskip("numpy")
    array = numpy.arange(6, dtype="float32").reshape(2, 3)
    encoded = codec.encode(array)
    assert encoded["__ndarray__"] is True
    assert encoded["shape"] == [2, 3]
    assert encoded["dtype"] == "float32"
    # BASE64, not raw bytes: replies go out through `ws.send_json`, which
    # cannot encode `bytes`. This assertion used to say `isinstance(..., bytes)`
    # and passed happily while `cmd.get_coords` failed for every real caller,
    # because it never put the dict on a wire. `json.dumps` below is the part
    # that actually matters.
    assert encoded["encoding"] == "base64"
    assert isinstance(encoded["data"], str)
    json.dumps(encoded)
    # THE copy-before-unlock rule (plan §B8): mutating the source must not
    # change what we already encoded, or a view onto C++ memory could escape
    # the API lock (layer2/CoordSet.cpp:326-361).
    before = encoded["data"]
    array[0, 0] = 99.0
    assert encoded["data"] == before
    raw = base64.b64decode(before)
    assert numpy.frombuffer(raw, dtype="float32")[0] == 0.0


def test_non_contiguous_arrays_are_made_contiguous() -> None:
    numpy = pytest.importorskip("numpy")
    array = numpy.arange(12, dtype="float32").reshape(3, 4)[:, ::2]
    encoded = codec.encode(array)
    # Decoded length, not the base64 length — the point of the test is that the
    # strided view was compacted, and base64 inflates by 4/3.
    assert len(base64.b64decode(encoded["data"])) == array.size * 4
    assert numpy.frombuffer(base64.b64decode(encoded["data"]), dtype="float32").tolist() == [
        0.0, 2.0, 4.0, 6.0, 8.0, 10.0,
    ]


def test_unknown_types_are_an_error_never_a_repr() -> None:
    class Weird:
        pass

    with pytest.raises(errors.NotSerializable) as excinfo:
        codec.encode(Weird())
    assert "no codec entry" in str(excinfo.value)
    assert errors.classify(excinfo.value) == errors.KIND_NOT_SERIALIZABLE


def test_blob_only_returns_refuse_to_inline() -> None:
    with pytest.raises(errors.NotSerializable):
        codec.encode_result("get_session", {"anything": 1}, blob_writer=None)


def test_blob_only_returns_go_through_the_writer() -> None:
    store = BlobStore()

    def writer(symbol, value):
        return store.put(value.encode(), name=symbol).as_wire()

    wire = codec.encode_result("get_vrml", "#VRML V2.0", blob_writer=writer)
    assert wire["__blob__"] is True
    assert store.get(wire["id"]).read() == b"#VRML V2.0"


def test_chempy_model_fields_are_whitelisted() -> None:
    chempy = pytest.importorskip("chempy")
    from chempy.models import Indexed

    model = Indexed()
    atom = chempy.Atom()
    atom.name = "CA"
    atom.resn = "ALA"
    atom.coord = [1.0, 2.0, 3.0]
    atom.secret = "must not travel"
    model.atom.append(atom)
    encoded = codec.encode(model)
    assert encoded["__model__"] == "Indexed"
    assert encoded["atom"][0]["name"] == "CA"
    assert encoded["atom"][0]["coord"] == [1.0, 2.0, 3.0]
    assert "secret" not in encoded["atom"][0]


# ------------------------------------------------------------------ errors


@pytest.mark.parametrize(
    "exc,kind",
    [
        (errors.NotAllowed("x"), errors.KIND_NOT_ALLOWED),
        (errors.NotSerializable("x"), errors.KIND_NOT_SERIALIZABLE),
        (errors.PyMOLUnavailable("x"), errors.KIND_PYMOL_UNAVAILABLE),
        (errors.NoOffscreenGL("x"), errors.KIND_NO_OFFSCREEN_GL),
        (ValueError("x"), errors.KIND_PYTHON_ERROR),
    ],
)
def test_error_kinds(exc, kind) -> None:
    assert errors.classify(exc) == kind
    payload = errors.error_payload(exc)
    assert payload["kind"] == kind
    assert set(payload) >= {"kind", "type", "message", "traceback"}
    assert kind in errors.WIRE_KINDS


def test_pymol_exceptions_classify_without_importing_pymol() -> None:
    import pymol
    from pymol.parsing import QuietException

    assert errors.classify(pymol.CmdException("x")) == errors.KIND_CMD_EXCEPTION
    assert errors.classify(QuietException()) == errors.KIND_QUIET_EXCEPTION
    # IncentiveOnlyException subclasses CmdException, so order matters.
    assert (
        errors.classify(pymol.IncentiveOnlyException())
        == errors.KIND_INCENTIVE_ONLY
    )


# --------------------------------------------------------------- manifest


#: Minimal argument lists so the call reaches the ``raise``, not a TypeError.
_INCENTIVE_ARGS = {
    "clean": ("all",),
    "assign_stereo": ("all",),
    "morph": ("m1", "m2"),
    "focal_blur": (),
    "callout": ("cs", "text"),
    "desaturate": (),
    "find_pi_interactions": (),
    "help_setting": ("ray_trace_mode",),
    "read_stlstr": (b"", "obj"),
    "get_stlstr": (),
    "read_collada": (b"", "obj"),
    "load_mtz": ("x.mtz", "obj"),
}


def test_incentive_manifest_matches_the_installed_build() -> None:
    """Every row still raises IncentiveOnlyException in THIS build."""
    import pymol

    checked = 0
    for entry in incentive_only.MANIFEST:
        if entry.symbol not in _INCENTIVE_ARGS:
            continue
        target = getattr(pymol.cmd, entry.symbol, None)
        if target is None or not callable(target):
            continue  # not exposed on cmd (e.g. the importing.py helper)
        checked += 1
        with pytest.raises(pymol.IncentiveOnlyException):
            target(*_INCENTIVE_ARGS[entry.symbol])
    assert checked >= 6, "the manifest stopped matching this build"


def test_incentive_lookup() -> None:
    assert incentive_only.is_incentive_only("clean")
    assert incentive_only.is_incentive_only("cmd.clean")
    assert not incentive_only.is_incentive_only("fragment")
    assert incentive_only.describe("cmd.clean").ui_action == "disable"
    assert incentive_only.as_wire()[0]["symbol"] == "clean"


# ---------------------------------------------------------------- framing


def test_binary_frame_keeps_the_payload_four_byte_aligned() -> None:
    """Zero-copy on the TS side depends on this; do not regress it."""
    for name in ("a", "ab", "abc", "abcd", "a" * 37):
        frame = session.encode_binary_frame({"topic": "geometry", "o": name}, b"\x00" * 12)
        (header_len,) = struct.unpack_from("<I", frame, 0)
        assert (4 + header_len) % session.HEADER_ALIGNMENT == 0
        meta, payload = session.decode_binary_frame(frame)
        assert meta["o"] == name
        assert bytes(payload) == b"\x00" * 12


def test_binary_framing_is_byte_identical_to_the_protocol_package() -> None:
    """WP-01 owns the normative producer; this asserts we did not drift.

    ``packages/protocol/python/tenmol_wire.py`` is the reference implementation
    that ``packages/protocol/test/roundtrip.test.ts`` decodes in TypeScript.  We
    do not import it at runtime (it is not on the bridge's sys.path and its
    header schema is WP-04/WP-26's, not ours) -- we only guarantee identical
    framing.
    """
    import importlib.util
    import pathlib

    reference = (
        pathlib.Path(__file__).resolve().parents[2]
        / "packages"
        / "protocol"
        / "python"
        / "tenmol_wire.py"
    )
    if not reference.exists():
        pytest.skip("packages/protocol/python/tenmol_wire.py has not landed")
    spec = importlib.util.spec_from_file_location("tenmol_wire_ref", reference)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    payload = bytes(range(37))
    for name in ("a", "ab", "abc", "abcd", "x" * 40):
        header = {"topic": "geometry", "object": name, "payloadBytes": len(payload)}
        assert session.encode_binary_frame(header, payload) == (
            module.encode_binary_frame(header, payload)
        ), name
    assert session.HEADER_ALIGNMENT == module.ALIGNMENT


def test_topics_are_the_frozen_v1_set() -> None:
    assert len(session.TOPICS) == 19
    for topic in ("feedback", "pixels", "objects", "menu", "geometry"):
        assert topic in session.TOPICS
    with pytest.raises(session.UnknownTopic):
        session.validate_topic("nope")


def test_topic_set_matches_the_protocol_packages_topic_modules() -> None:
    """One topic module per topic, both sides, no drift (plan §5.2).

    The authority on the TypeScript side is the frozen barrel
    ``packages/protocol/src/topics/index.ts``: a module is a wire topic exactly
    when the barrel re-exports it. The directory also holds *shared-vocabulary*
    modules (WP-11 `console`, WP-14 `menus`, WP-18 `files`, …) that the barrel
    deliberately does not re-export — they are reached by their subpath and ride
    an existing topic. Comparing the raw directory listing would make every such
    module a false positive while still missing the failure that matters: a real
    topic module that the barrel forgot.
    """
    import pathlib
    import re

    topics_dir = (
        pathlib.Path(__file__).resolve().parents[2]
        / "packages"
        / "protocol"
        / "src"
        / "topics"
    )
    if not topics_dir.is_dir():
        pytest.skip("packages/protocol/src/topics/ has not landed")

    barrel = (topics_dir / "index.ts").read_text(encoding="utf-8")
    exported = set(re.findall(r"^export \* from '\./([A-Za-z0-9_]+)';", barrel, re.M))
    assert exported == set(session.TOPICS), {
        "only-in-typescript": sorted(exported - set(session.TOPICS)),
        "only-in-bridge": sorted(set(session.TOPICS) - exported),
    }

    # Every re-exported module must actually exist on disk.
    on_disk = {
        path.stem
        for path in topics_dir.glob("*.ts")
        if not path.stem.startswith("_") and path.stem != "index"
    }
    assert exported <= on_disk, sorted(exported - on_disk)

    # And every non-topic module in the directory must say so in its header, so
    # a genuinely forgotten topic cannot hide among the shared-vocabulary ones.
    for stem in sorted(on_disk - exported):
        header = (topics_dir / f"{stem}.ts").read_text(encoding="utf-8")
        assert "@notATopic" in header, (
            f"packages/protocol/src/topics/{stem}.ts is not re-exported by the "
            "frozen barrel, so it is not a wire topic. Either register the topic "
            "bridge-side and add it to index.ts, or declare `@notATopic` in its "
            "module header."
        )


def test_subscription_sequence_numbers_are_monotonic_per_topic() -> None:
    subs = session.Subscriptions()
    subs.add("feedback")
    subs.add("view")
    assert [subs.next_seq("feedback") for _ in range(3)] == [1, 2, 3]
    assert subs.next_seq("view") == 1
    assert "feedback" in subs
    subs.remove("feedback")
    assert "feedback" not in subs


# ------------------------------------------------------------------ blobs


def test_blob_store_serves_and_evicts() -> None:
    store = BlobStore(max_bytes=64)
    first = store.put(b"x" * 40, mime="image/png", name="a.png")
    assert store.get(first.id).read() == b"x" * 40
    assert first.as_wire()["url"] == "/blob/%s" % first.id
    store.put(b"y" * 40)
    with pytest.raises(BlobNotFound):
        store.get(first.id)


# ------------------------------------------------- dispatch, over the wire


def test_call_reports_invalidation_classes(ws) -> None:
    reply = ws.call_reply("fragment", "ala")
    assert reply["t"] == "ok"
    assert set(reply.get("invalidates", [])) >= {"names", "geometry", "coords"}
    ws.call("delete", "all")


def test_do_forces_a_full_resync(ws) -> None:
    reply = ws.do("fragment gly")
    assert reply["t"] == "ok"
    assert reply["invalidates"] == ["resync"]
    ws.call("delete", "all")


def test_unknown_symbol_is_not_allowed_not_a_crash(ws) -> None:
    reply = ws.call_reply("no_such_command_at_all")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == errors.KIND_NOT_ALLOWED


def test_pymol_errors_arrive_typed(ws) -> None:
    reply = ws.call_reply("color", "not_a_real_color", "all")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] in (
        errors.KIND_CMD_EXCEPTION,
        errors.KIND_PYTHON_ERROR,
    )
    assert reply["error"]["message"]


def test_incentive_only_symbol_answers_with_its_own_kind(ws) -> None:
    reply = ws.call_reply("clean", "all")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == errors.KIND_INCENTIVE_ONLY


def test_quiet_is_passed_through_not_forced(ws, bridge) -> None:
    """Critique C4: parity rows depend on quiet=0 output reaching the console.

    A direct API call is silent (spike 02 §8); ``quiet=0`` is what makes it
    speak.  If the bridge forced ``quiet=1`` this line would never exist.
    """
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    assert ws.call("count_atoms", "all", quiet=1) == 10
    assert not any(
        "count_atoms:" in line for line in bridge.feedback_lines()[-5:]
    )
    assert ws.call("count_atoms", "all", quiet=0) == 10
    lines = bridge.wait_for_feedback("count_atoms:", timeout=3.0)
    assert any(line.strip() == "count_atoms: 10 atoms" for line in lines), lines[-5:]
    ws.call("delete", "all")


def test_a_non_serialisable_return_is_typed(ws) -> None:
    """get_session must never be inlined; it becomes a blob handle."""
    ws.call("delete", "all")
    ws.call("fragment", "ala")
    reply = ws.call_reply("get_session")
    assert reply["t"] == "ok", reply
    assert reply["result"]["__blob__"] is True
    assert reply["result"]["size"] > 0
    ws.call("delete", "all")


def test_input_reshape_round_trips(ws, bridge) -> None:
    original = bridge.healthz()
    reply = ws.input("reshape", width=640, height=480)
    assert reply["t"] == "ok"
    assert reply["result"] == {"width": 640, "height": 480}
    assert ws.call("get_viewport") == [640, 480]
    # put it back for the other tests
    ws.input("reshape", width=original["width"], height=original["height"])
    assert ws.call("get_viewport") == [original["width"], original["height"]]


def test_bad_frames_do_not_kill_the_socket(ws) -> None:
    reply = ws.request(t="nonsense")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == errors.KIND_BAD_MESSAGE
    reply = ws.request(t="sub", topic="not-a-topic")
    assert reply["t"] == "err"
    assert reply["error"]["kind"] == errors.KIND_BAD_MESSAGE
    # ...and the connection still works
    assert ws.call("get_frame") == 1
