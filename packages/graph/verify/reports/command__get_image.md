# command__get_image — BLOCKED (binary/blob return)

`cmd.get_image` returns a PNG export as **binary blob data**. The oracle bridge
cannot serialize bytes over the JSON wire — the differential receives a
`{__blob__}`/`{__blobs__}` handle (or a `NotSerializable` TypeError), never the
bytes — so there is **no inline ground truth** to differentially verify against,
and fabricating an expected value is disallowed by the protocol.

Even with a blob-diff harness the engine's serializer/renderer and the oracle's
(llvmpipe) would not produce byte-identical output, so only a fuzzy/structural
comparison would be possible. Tracked as a harness limitation, not an engine gap.
