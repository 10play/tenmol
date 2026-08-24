# feature__cartoon_rectangle — BLOCKED (pixel-only cartoon subtype)

The cartoon SUBTYPE (rectangle/tube/...) differs only in rendered pixels. Against
the real-PyMOL oracle it has no state observable: `cmd.cartoon` returns an opaque
constant, `count_atoms("cartoon <N>")` stays 0, and `iterate ... print(cartoon)`
writes to stdout. Needs a pixel-diff harness (not the state-proxy differential).
The engine implements the subtype; it just cannot be differentially verified via
state. See command__cartoon.md.
