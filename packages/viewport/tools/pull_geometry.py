#!/usr/bin/env python
"""Pull REAL Mode-G geometry out of PyMOL and write protocol binary frames.

    <venv>/bin/python packages/viewport/tools/pull_geometry.py \
        --pdb /path/to/1UBQ.pdb --out /tmp/frames \
        --rep cartoon --rep sticks --rep spheres --rep surface

Why this exists
---------------
`layer4/CmdWebGeometry.cpp` (`_cmd.web_get_rep_geometry`, spike 06) already
returns PyMOL's own CPU-side buffers, and `packages/protocol/python/tenmol_wire.py`
already knows the frame layout. What does not exist yet is the piece in the
middle: nothing in `bridge/tenmol_bridge` joins them up and puts a
`cgo-draw-arrays` / `indexed-mesh` frame on the WebSocket. That is the bridge's
work package, not the viewport's.

So this script is two things:

1. the fixture generator that lets `@tenmol/viewport`'s Mode G be developed and
   DEMONSTRATED against real accessor output rather than invented geometry, and
2. the executable reference for the bridge producer: the accessor payload ->
   wire-frame mapping in ~150 readable lines, including the two places where a
   naive mapping is wrong (see NOTE 1 and NOTE 2 below).

NOTE 1 — draw-arrays blocks must be REPACKED. The accessor returns each block's
sub-arrays separately (`vertex`, `normal`, `rgba`, ...), but `cgo::draw::arrays`
on the wire is ONE heap block whose sub-arrays are CONSECUTIVE in the order
`layer1/CGO.cpp:1650-1671` fixes: [vertex 3N][normal 3N][color 4N]
[pickcolor rgba N + index 2N][accessibility N]. `cgoArraysLayout()` on the
client assumes exactly that, so the producer concatenates in that order and
declares matching `arraybits`.

NOTE 2 — picking rides a different channel. The wire block layout reserves a
packed-RGBA pick slot that PyMOL regenerates per frame; we drop the pick bit
here instead of shipping a meaningless colour. Picking is backend-authoritative
(plan §1.4), so nothing is lost.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
sys.path.insert(0, os.path.join(REPO_ROOT, "packages", "protocol", "python"))

import pymol  # noqa: E402  (import order: pymol sets PYMOL_PATH for chempy)
import pymol2  # noqa: E402
import tenmol_wire as wire  # noqa: E402

#: `enum cRep_t`, layer1/Rep.h:48-74 -- the same table as REP_NAMES in
#: packages/protocol/src/geometry.ts.
REP_INDEX = {
    "sticks": 0,
    "spheres": 1,
    "surface": 2,
    "labels": 3,
    "nb_spheres": 4,
    "cartoon": 5,
    "ribbon": 6,
    "lines": 7,
    "mesh": 8,
    "dots": 9,
    "dashes": 10,
    "nonbonded": 11,
    "cell": 12,
    "cgo": 13,
    "callback": 14,
    "extent": 15,
    "slice": 16,
    "angles": 17,
    "dihedrals": 18,
    "ellipsoids": 19,
    "volume": 20,
}

CGO_NORMAL_BIT = wire.CGO_ARRAY_BIT["normal"]
CGO_COLOR_BIT = wire.CGO_ARRAY_BIT["color"]
CGO_PICK_BIT = wire.CGO_ARRAY_BIT["pickColor"]
CGO_ACCESS_BIT = wire.CGO_ARRAY_BIT["accessibility"]


def _f32(data):
    return b"" if data is None else bytes(data)


def _interleave(chunks, counts):
    """Interleave float32 byte buffers into one instance array.

    `chunks` is [(bytes, floats_per_item), ...]; every chunk must hold `counts`
    items. Returns bytes with stride == sum(floats_per_item).
    """
    import array

    out = array.array("f")
    views = [array.array("f", chunk) for chunk, _ in chunks]
    sizes = [size for _, size in chunks]
    for i in range(counts):
        for view, size in zip(views, sizes):
            out.extend(view[i * size : (i + 1) * size])
    return out.tobytes()


def encode_cgo(payload, seq):
    """`kind == 'cgo'` -> a `cgo-draw-arrays` frame."""
    packer = wire.BufferPacker()
    blocks = []
    for block in payload.get("draw_arrays", []):
        nverts = int(block["nverts"])
        arraybits = 0
        parts = [_f32(block["vertex"])]
        if block.get("normal"):
            arraybits |= CGO_NORMAL_BIT
            parts.append(_f32(block["normal"]))
        if block.get("rgba"):
            arraybits |= CGO_COLOR_BIT
            parts.append(_f32(block["rgba"]))
        if block.get("accessibility"):
            arraybits |= CGO_ACCESS_BIT
            parts.append(_f32(block["accessibility"]))
        data = b"".join(parts)               # NOTE 1: consecutive, in this order
        expected = wire.cgo_narrays(arraybits) * nverts * 4
        assert len(data) == expected, (len(data), expected, arraybits, nverts)
        ref = packer.add(data, "f32", 1)
        blocks.append(
            {
                "mode": int(block["mode"]),
                "arraybits": arraybits,
                "nverts": nverts,
                "data": ref,
            }
        )

    instances = []
    spheres = payload.get("spheres")
    if spheres and spheres.get("n"):
        n = int(spheres["n"])
        data = _interleave([(spheres["xyzr"], 4), (spheres["rgba"], 4)], n)
        instances.append(
            {
                "kind": "sphere",
                "count": n,
                "itemSize": 8,
                "data": packer.add(data, "f32", 8),
                "atom": packer.add(_pick_atom(spheres.get("pick"), n), "i32", 1),
            }
        )

    cylinders = payload.get("cylinders")
    if cylinders and cylinders.get("n"):
        n = int(cylinders["n"])
        # origin(3) axis(3) radius(1) | cap(1, int -> float) | rgba1(4) rgba2(4)
        cap_as_float = _int_to_float(cylinders["cap"], n)
        data = _interleave(
            [
                (cylinders["origin_axis_radius"], 7),
                (cap_as_float, 1),
                (cylinders["rgba1"], 4),
                (cylinders["rgba2"], 4),
            ],
            n,
        )
        instances.append(
            {
                "kind": "cylinder2",
                "count": n,
                "itemSize": 16,
                "data": packer.add(data, "f32", 16),
                "atom": packer.add(_pick_atom(cylinders.get("pick1"), n), "i32", 1),
            }
        )

    header = wire.cgo_header(
        object=payload["object"],
        state=int(payload["state"]),
        rep=int(payload["rep_index"]),
        seq=seq,
        blocks=blocks,
        instances=instances,
    )
    return wire.encode_binary_frame(header, packer.payload())


def _int_to_float(data, n):
    """cap bits arrive as int32; the instance stride is all float32."""
    import array

    ints = array.array("i", bytes(data))
    return array.array("f", [float(v) for v in ints[:n]]).tobytes()


def _pick_atom(pick, n):
    """`pick` is int32 (atom, bond) pairs; the wire wants one atom index."""
    import array

    if pick is None:
        return array.array("i", [-1] * n).tobytes()
    pairs = array.array("i", bytes(pick))
    return array.array("i", [pairs[i * 2] for i in range(n)]).tobytes()


def encode_surface(payload, seq):
    """`kind == 'surface'` -> an `indexed-mesh` frame."""
    packer = wire.BufferPacker()
    buffers = {"position": packer.add(payload["vertex"], "f32", 3)}
    if payload.get("normal"):
        buffers["normal"] = packer.add(payload["normal"], "f32", 3)
    if payload.get("color"):
        buffers["color"] = packer.add(payload["color"], "f32", 3)
    if payload.get("alpha"):
        buffers["alpha"] = packer.add(payload["alpha"], "f32", 1)
    if payload.get("ao"):
        buffers["ao"] = packer.add(payload["ao"], "f32", 1)
    if payload.get("index"):
        buffers["index"] = packer.add(payload["index"], "i32", 3)
    if payload.get("atom"):
        buffers["atom"] = packer.add(payload["atom"], "i32", 1)
    if payload.get("visible"):
        buffers["vis"] = packer.add(payload["visible"], "i32", 1)

    header = wire.indexed_mesh_header(
        object=payload["object"],
        state=int(payload["state"]),
        rep=int(payload["rep_index"]),
        seq=seq,
        verts=int(payload["n_vert"]),
        tris=int(payload["n_tri"]),
        buffers=buffers,
        proximity=bool(payload.get("proximity", False)),
        one_color=payload.get("rgb") if payload.get("one_color_flag") else None,
    )
    return wire.encode_binary_frame(header, packer.payload())


def pull(cmd, obj, rep, state=-1):
    """The locking contract of every `_cmd` entry point (spike 06 §7)."""
    cmd.lock(_self=cmd)
    try:
        return cmd._cmd.web_get_rep_geometry(cmd._COb, obj, state, rep, 1)
    finally:
        cmd.unlock(-1, _self=cmd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdb", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--name", default="m")
    parser.add_argument("--rep", action="append", default=None)
    parser.add_argument("--color", default="util.cbc")
    args = parser.parse_args(argv)
    reps = args.rep or ["cartoon", "sticks", "spheres", "surface"]

    os.makedirs(args.out, exist_ok=True)

    p = pymol2.SingletonPyMOL()
    p.start()
    cmd = p.cmd
    cmd.set("internal_gui", 0)
    cmd.set("internal_feedback", 0)
    cmd.load(args.pdb, args.name)
    cmd.hide("everything")
    for rep in reps:
        cmd.show(rep, args.name)
    if args.color == "util.cbc":
        from pymol import util

        util.cbc(selection=args.name, _self=cmd)
    cmd.orient(args.name)
    cmd.refresh()

    manifest = {"object": args.name, "frames": [], "view": list(cmd.get_view())}
    for seq, rep in enumerate(reps):
        payload = pull(cmd, args.name, rep)
        status = payload.get("status")
        if status != "ok":
            print("%-10s %s: %s" % (rep, status, payload.get("message")))
            continue
        kind = payload.get("kind")
        payload.setdefault("object", args.name)
        payload.setdefault("rep_index", REP_INDEX[rep])
        if kind == "surface":
            frame = encode_surface(payload, seq)
        elif kind == "cgo":
            frame = encode_cgo(payload, seq)
        else:
            print("%-10s unsupported kind %r" % (rep, kind))
            continue
        name = "%s.%s.bin" % (args.name, rep)
        path = os.path.join(args.out, name)
        with open(path, "wb") as fh:
            fh.write(frame)
        header_len = struct.unpack("<I", frame[:4])[0]
        header = json.loads(frame[4 : 4 + header_len])
        summary = {
            "rep": rep,
            "file": name,
            "bytes": len(frame),
            "kind": header["kind"],
            "blocks": len(header.get("blocks", [])),
            "instances": [
                {"kind": i["kind"], "count": i["count"]} for i in header.get("instances", [])
            ],
            "counts": header.get("counts"),
        }
        manifest["frames"].append(summary)
        print(
            "%-10s %-16s %9d B  blocks=%-3d instances=%s counts=%s"
            % (
                rep,
                header["kind"],
                len(frame),
                summary["blocks"],
                summary["instances"],
                summary["counts"],
            )
        )

    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print("wrote %s/manifest.json (%d frames)" % (args.out, len(manifest["frames"])))
    print("pymol", pymol.get_version_message())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
