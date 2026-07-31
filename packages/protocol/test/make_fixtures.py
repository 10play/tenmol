#!/usr/bin/env python3
"""Encode binary-frame fixtures in Python for the TypeScript round-trip test.

WP-01 acceptance: "a round-trip test encodes in Python and decodes in TS with
zeroCopyPos === true."

Writes into the directory given as argv[1]:

    surface.bin      indexed-mesh  (RepSurface: V/VN/VC/VA/T/AT/Vis)
    cartoon.bin      cgo-draw-arrays, one GL_TRIANGLE_STRIP block
    spheres.bin      cgo, instance buffers only -- NEVER tessellated
    pixels.bin       Mode P bitmap frame
    misaligned.bin   deliberately 2-byte-offset BufferRef (negative control)
    expected.json    every value the TS side asserts against

Stdlib only, so it runs under any python3 as well as the PyMOL venv.
"""

from __future__ import annotations

import array
import json
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "python"))

import tenmol_wire as w  # noqa: E402


def f32(values):
    a = array.array("f", values)
    if sys.byteorder != "little":
        a.byteswap()
    return a.tobytes()


def i32(values):
    a = array.array("i", values)
    if sys.byteorder != "little":
        a.byteswap()
    return a.tobytes()


def main(outdir: str) -> None:
    os.makedirs(outdir, exist_ok=True)
    expected = {}

    # ------------------------------------------------------------------ #
    # 1. indexed-mesh: RepSurface, 4 verts / 2 triangles.
    #    Field names map onto struct RepSurface (layer2/RepSurface.cpp:59-101):
    #    position<-V normal<-VN color<-VC alpha<-VA index<-T atom<-AT vis<-Vis
    # ------------------------------------------------------------------ #
    position = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0]
    normal = [0.0, 0.0, 1.0] * 4
    color = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0]
    alpha = [1.0, 1.0, 0.5, 0.5]
    tri = [0, 1, 2, 0, 2, 3]
    atom = [17, 18, 19, 20]  # RepSurface::AT -- closest atom per vertex
    vis = [1, 1, 1, 0]

    p = w.BufferPacker()
    buffers = {
        "position": p.add(f32(position), "f32", 3),
        "normal": p.add(f32(normal), "f32", 3),
        "color": p.add(f32(color), "f32", 3),
        "alpha": p.add(f32(alpha), "f32", 1),
        "index": p.add(i32(tri), "i32", 3),
        "atom": p.add(i32(atom), "i32", 1),
        "vis": p.add(i32(vis), "i32", 1),
    }
    header = w.indexed_mesh_header(
        object="1ubq",
        state=1,
        rep=2,  # cRepSurface
        seq=41,
        verts=4,
        tris=2,
        buffers=buffers,
        proximity=True,
        one_color=None,
        level=35,  # cRepInvRep
    )
    frame = w.encode_binary_frame(header, p.payload())
    open(os.path.join(outdir, "surface.bin"), "wb").write(frame)
    expected["surface"] = {
        "bytes": len(frame),
        "headerLength": struct.unpack_from("<I", frame, 0)[0],
        "position": position,
        "atom": atom,
        "vis": vis,
        "index": tri,
        "alpha": alpha,
        "buffers": buffers,
    }

    # ------------------------------------------------------------------ #
    # 2. cgo-draw-arrays: one GL_TRIANGLE_STRIP block, passed VERBATIM.
    #    Sub-arrays are CONSECUTIVE, not interleaved (layer1/CGO.cpp:1650-1671):
    #      [vertex 3N][normal 3N][color 4N][pick rgba N][pick index 2N]
    # ------------------------------------------------------------------ #
    nverts = 3
    arraybits = 0x01 | 0x02 | 0x04 | 0x08  # vertex|normal|color|pickColor
    block_vertex = [0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 2.0, 0.0]
    block_normal = [0.0, 0.0, 1.0] * nverts
    block_color = [0.2, 0.4, 0.6, 1.0] * nverts
    block_pick_rgba = [0.0, 0.0, 0.0]
    block_pick_index = [7.0, -1.0, 8.0, -1.0, 9.0, -1.0]
    block_floats = (
        block_vertex + block_normal + block_color + block_pick_rgba + block_pick_index
    )
    assert len(block_floats) == w.cgo_narrays(arraybits) * nverts

    p = w.BufferPacker()
    block = {
        "mode": 5,  # GL_TRIANGLE_STRIP
        "arraybits": arraybits,
        "nverts": nverts,
        "data": p.add(f32(block_floats), "f32", 1),
    }
    header = w.cgo_header(
        object="1ubq", state=1, rep=5, seq=42, blocks=[block], instances=[]  # cRepCartoon
    )
    frame = w.encode_binary_frame(header, p.payload())
    open(os.path.join(outdir, "cartoon.bin"), "wb").write(frame)
    expected["cartoon"] = {
        "bytes": len(frame),
        "nverts": nverts,
        "arraybits": arraybits,
        "narrays": w.cgo_narrays(arraybits),
        "vertex": block_vertex,
        "normal": block_normal,
        "color": block_color,
        "pickIndex": block_pick_index,
        "block": block,
    }

    # ------------------------------------------------------------------ #
    # 3. Instance buffers -- spheres are NEVER tessellated (plan 1.3, c1).
    #    sphere item = cx,cy,cz,radius, r,g,b,a  (8 float32)
    # ------------------------------------------------------------------ #
    sphere_items = [
        0.0, 0.0, 0.0, 1.4, 1.0, 0.0, 0.0, 1.0,
        3.0, 0.0, 0.0, 1.7, 0.0, 1.0, 0.0, 1.0,
        0.0, 3.0, 0.0, 1.2, 0.0, 0.0, 1.0, 0.5,
    ]
    sphere_atoms = [101, 102, 103]
    sphere_bonds = [-1, -1, -1]
    p = w.BufferPacker()
    inst = {
        "kind": "sphere",
        "count": 3,
        "itemSize": w.INSTANCE_ITEM_SIZE["sphere"],
        "data": p.add(f32(sphere_items), "f32", w.INSTANCE_ITEM_SIZE["sphere"]),
        "atom": p.add(i32(sphere_atoms), "i32", 1),
        "bond": p.add(i32(sphere_bonds), "i32", 1),
    }
    header = w.cgo_header(
        object="1ubq", state=1, rep=1, seq=43, blocks=[], instances=[inst]  # cRepSphere
    )
    frame = w.encode_binary_frame(header, p.payload())
    open(os.path.join(outdir, "spheres.bin"), "wb").write(frame)
    expected["spheres"] = {
        "bytes": len(frame),
        "items": sphere_items,
        "atoms": sphere_atoms,
        "instance": inst,
    }

    # ------------------------------------------------------------------ #
    # 4. Mode P bitmap frame. Payload stands in for JPEG bytes.
    # ------------------------------------------------------------------ #
    jpeg = b"\xff\xd8\xff\xe0" + b"tenmol-mode-p-fixture" + b"\xff\xd9"
    header = w.pixel_header(
        width=1280,
        height=960,
        dpr=1.0,
        encoding="jpeg",
        quality=80,
        frame_id=7,
        seq=44,
        flip_y=True,
        reps=[5, 2],
    )
    frame = w.encode_binary_frame(header, jpeg)
    open(os.path.join(outdir, "pixels.bin"), "wb").write(frame)
    expected["pixels"] = {
        "bytes": len(frame),
        "payloadBytes": len(jpeg),
        "soi": [0xFF, 0xD8, 0xFF, 0xE0],
        "width": 1280,
        "height": 960,
        "frameId": 7,
    }

    # ------------------------------------------------------------------ #
    # 5. NEGATIVE CONTROL: a producer that ignores the 4-byte alignment.
    #    The client must still be CORRECT, but the view is a memcpy, and
    #    geometryFrameProblems() must say so. This is the regression guard for
    #    "keep the 4-byte header alignment already implemented and verified".
    # ------------------------------------------------------------------ #
    pad = b"\0\0"  # 2 bytes -> every following ref is 2 mod 4
    body = f32(position)
    payload = pad + body
    header = w.indexed_mesh_header(
        object="1ubq",
        state=1,
        rep=2,
        seq=45,
        verts=4,
        tris=0,
        buffers={
            "position": {
                "byteOffset": 2,
                "byteLength": len(body),
                "dtype": "f32",
                "itemSize": 3,
            }
        },
    )
    frame = w.encode_binary_frame(header, payload)
    open(os.path.join(outdir, "misaligned.bin"), "wb").write(frame)
    expected["misaligned"] = {"bytes": len(frame), "position": position}

    with open(os.path.join(outdir, "expected.json"), "w") as fh:
        json.dump(expected, fh, indent=2)

    print("python: wrote 5 frames + expected.json to %s" % outdir)
    for name in ("surface", "cartoon", "spheres", "pixels", "misaligned"):
        path = os.path.join(outdir, name + ".bin")
        raw = open(path, "rb").read()
        hlen = struct.unpack_from("<I", raw, 0)[0]
        print(
            "python:   %-11s %6d B  headerLength=%4d (%% 4 == %d)  payloadStart=%d"
            % (name + ".bin", len(raw), hlen, hlen % 4, 4 + hlen)
        )

    # Self-check: the Python decoder must accept its own output.
    for name in ("surface", "cartoon", "spheres", "pixels", "misaligned"):
        raw = open(os.path.join(outdir, name + ".bin"), "rb").read()
        h, pl = w.decode_binary_frame(raw)
        assert h["v"] == 1, name
        assert len(pl) == h["payloadBytes"], name
    print("python: self-decode of all 5 frames OK")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fixtures")
