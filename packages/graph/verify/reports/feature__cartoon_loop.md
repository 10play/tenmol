# feature__cartoon_loop — BLOCKED (pixel-only cartoon subtype)

The `cartoon` command sets a cartoon rendering SUBTYPE (automatic/loop/tube/
oval/arrow/dumbbell/putty). Against the real-PyMOL oracle this has **no state
observable**:
- `cmd.cartoon(type, sele)` returns an opaque constant (35) regardless of the
  type or selection — not a count, nothing to diff meaningfully.
- `count_atoms("cartoon <N>")` returns 0 even after the command — the subtype is
  a per-object/per-rendering property, not a selector-visible per-atom field.
- `iterate ... print(cartoon)` writes to stdout, not a wire-returned value.

The subtype differs ONLY in rendered pixels, so it needs a pixel-diff harness
(not the state-proxy differential this grind uses). The engine DOES implement the
subtype (`packages/engine-ts/src/cmd/display.ts` cartoon command + per-object
CARTOON_TYPE); it simply cannot be differentially verified via state. Promote to
a probe once pixel comparison exists.
