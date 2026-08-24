# command__get_vrml — BLOCKED (binary/blob return)

`cmd.get_vrml` returns a VRML scene export as blob data. The oracle bridge cannot
serialize it over the JSON wire — the differential receives a `{__blob__}` handle,
never the text — so there is no inline ground truth to differentially verify
against (same class as get_collada / get_idtf / get_bytes).
