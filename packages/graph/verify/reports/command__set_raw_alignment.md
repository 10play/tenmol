# command__set_raw_alignment — BLOCKED (oracle crashes)

`cmd.set_raw_alignment(name, raw, guide, state)` reliably **segfaults** the real
PyMOL oracle (WebSocket closes with code 1006, `/healthz` goes dead) for every
input tried, including:

- separately-loaded objects `p1`/`p2` with a hand-built raw alignment
- a `create`d identical copy (`create p2, p1`) with valid 1-based atom indices
- with and without an explicit `guide=` object

`_cmd.set_raw_alignment` in this Open-Source build crashes the C layer, so there
is **no ground truth** to differentially verify against — fabricating an expected
value is disallowed by the protocol.

The engine-ts port IS implemented and behaves sensibly: it normalises `raw` into
`[objectName, index]` columns and stores them where `get_raw_alignment` reads
them back (see `packages/engine-ts/src/cmd/align.ts` and the unit test
`packages/engine-ts/test/set-raw-alignment.test.ts`). It can be promoted to a
committed probe once the oracle no longer crashes on this API.
