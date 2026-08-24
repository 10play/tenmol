# command__get_renderer — BLOCKED (environment-specific identity)

`cmd.get_renderer` returns the live GL vendor/renderer/version triple. The oracle
(Mesa/llvmpipe/4.6) and the TS engine (`tenmol-engine-ts (WebGL2)`) each correctly
report their OWN renderer, so there is no shared ground truth to match — the values
are meant to differ by environment, not a port gap. Not differentially verifiable.
