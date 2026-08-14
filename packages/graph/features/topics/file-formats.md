---
name: file-formats
kind: feature
category: file-io
subcategory: file formats & I/O
summary: Every command that reads structures, maps, sessions, images and scripts off disk or the network, writes them back out, or moves them through in-memory strings — plus the full table of supported molecular/map/session formats.
parity: implemented
---

# File formats & File I/O

PyMOL's file layer is **extension-dispatched**: the loader/saver looks at the filename suffix,
maps it to an internal `format` token, and routes to a Python handler or the C core. This doc
covers every import command, every export command, the in-memory string helpers, session
serialisation, log/script execution, `fetch`, and the complete list of formats the engine can
read and write.

All source references are `path:line` into `packages/engine/` (unmodified upstream). The web
port serves this whole surface through `cmd.tenmol_files.*` on the bridge; behavioural detail on
the GUI wiring lives in [file-io.md](../../../../docs/file-io.md).

---

## Supported formats (the master table)

Format detection is `filename_to_format` (`importing.py:41-109`): it returns
`(prefix, ext, format, zipped)`, stripping a trailing `.gz`/`.bz2` into `zipped` and re-parsing
the previous extension, then normalising aliases (`ent|p5m`→`pdb`, `mmcif`→`cif`, `sd`→`sdf`,
`o|dsn6|omap`→`brix`, `maegz`→`mae`+gz, `xml`→`pdbml`, `pdb\d+`→`pdb`, …). Load handlers live in
`loadfunctions` (`importing.py:1619-1644`); save handlers in `savefunctions`
(`exporting.py:988-1020`). Anything without a Python handler falls through to the C core / VMD
molfile plugins.

| Format | Ext(s) | Load | Save | Notes |
| --- | --- | --- | --- | --- |
| PDB | `.pdb .ent .p5m .pdbN` | ✓ | ✓ | `load`→`read_pdbstr`; save via `get_str` |
| PDBx / mmCIF | `.cif .mmcif` | ✓ | ✓ | preferred `fetch_type_default` |
| Binary CIF | `.bcif` | ✓ | ✓ | save via `get_bytes` |
| PDBML | `.xml` | ✓ | – | `pdbml` handler |
| MDL MOL / SDF | `.mol .sdf .sd .sdfgz` | ✓ | ✓ | multi-record SDF |
| MOL2 (Sybyl) | `.mol2` | ✓ | ✓ | |
| XYZ | `.xyz .xyz_N` | ✓ | ✓ | |
| MacroModel | `.mmd .mmod .dat .out` | ✓ | ✓ | save token `mmod` (`io.mmd.toFile`) |
| PQR | `.pqr` | ✓ | ✓ | PDB + charge/radius |
| Maestro | `.mae .maegz` | ✗ | ✓ | **load raises `IncentiveOnlyException`**; save via `get_str` |
| MMTF | `.mmtf` | ✓ | ✓ | `load_mmtf`; honours `assembly` setting |
| CML | `.cml` | ✓ | – | |
| ChemPy pickle | `.pkl .pkla` | ✓ | ✓ | Python-object formats |
| CCP4 / MRC map | `.ccp4 .mrc .map` | ✓ | ✓ | `normalize_ccp4_maps` |
| BRIX / O / DSN6 map | `.o .brix .dsn6 .omap` | ✓ | – | `normalize_o_maps` |
| XPLOR map | `.xplor` (str) | ✓ | – | `read_xplorstr` / `load` |
| DX / DXbin | `.dx .dxbin` | ✓ | – | volumetric |
| MTZ reflections | `.mtz` | ✗ | – | `load_mtz` raises `IncentiveOnlyException` here |
| PyMOL session | `.pse .psw .pze .pzw` | ✓ | ✓ | pickled session (see below) |
| PyMOL web-game | `.pwg` | ✓ | – | launches an HTTP server — **refused** by the bridge |
| PNG image | `.png` | ✓ | ✓ | `load_png` (movie frame); save = `png` |
| CGO / geometry | `.ply .r3d .cc1 .cc2` | ✓ | – | `load_ply`/`load_r3d`/`load_cc1` |
| STL | `.stl` | ✓ | ✓ | `lazyio` |
| COLLADA | `.dae` | ✓ | ✓ | `get_collada` |
| glTF | `.gltf` | ✓ | ✓ | `get_gltf` |
| VRML 2 | `.wrl` | – | ✓ | `get_vrml` |
| POV-Ray | `.pov` | – | ✓ | `get_povray` |
| IDTF | `.idtf` | – | ✓ | `get_idtf` |
| Wavefront OBJ/MTL | `.obj .mtl` | – | ✗ | **`.mtl` raises ".MTL export not implemented"** |
| PMO | `.pmo` | – | ✗ | explicitly rejected by `multisave` |
| Trajectories | `.dcd .dtr .xtc .trr .trj .crd .nc` | ✓ | – | via `load_traj`; magic-byte autodetect |
| Alignment | `.aln .fasta` | ✓ | ✓ | ClustalW / FASTA |
| MMOD/VIS/MOE/PHYPO | `.vis .moe .ph4 .phypo` | ✗ | – | incentive-only builds |

Compression: `.gz`/`.bz2` are transparent on both read and write (except `multisave`, which
rejects them).

---

## load

### Purpose
The universal reader for molecules, crystallographic/volumetric maps, PyMOL sessions, and a
handful of other content types. Format is guessed from the extension (or passed explicitly), and
the object name defaults to the filename prefix.

### Syntax
`load(filename, object='', state=0, format='', finish=1, discrete=-1, quiet=1, multiplex=None, zoom=-1, partial=0, mimic=1, object_props=None, atom_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | – | file path or URL |
| `object` | string | `''` | object name (default: filename prefix) |
| `state` | int | `0` | target state; 0 = append as new state |
| `format` | str/int | `''` | override; numeric loadable enum or `plugin:<name>` accepted |
| `finish` | int | `1` | finish object after load |
| `discrete` | int | `-1` | discrete-state object (each state independent) |
| `quiet` | int | `1` | suppress feedback |
| `multiplex` | int | `None` | split multi-model file into separate objects |
| `zoom` | int | `-1` | zoom to loaded object (setting-controlled default) |
| `partial` | int | `0` | partial session merge (for `.pse`) |
| `mimic` | int | `1` | Maestro: mimic cartoon/stick styling from settings |
| `object_props` / `atom_props` | | `None` | property import filters |

### Behaviour
- URLs (`://`) are fetched through `file_read`, which sets a `PyMOL/<ver>` User-Agent and
  gunzips/bunzips by magic bytes (`internal.py:279-311`).
- `.trj` autodetects AMBER vs GROMACS/NetCDF by magic bytes; `.crd` autodetects AMBER vs CHARMM.
- Unknown extensions fall through to VMD molfile plugins via `_cmd.find_molfile_plugin`.
- For `dcd`/`dtr` the default object is the most recently added object (trajectory append).
- `.pse`/`.psw` delegate to `load_pse`; string-loadable formats route to their `read_*str`
  handler with `file_read` first.

### Examples
```
load 1abc.pdb
load traj.xtc, mymol
load https://files.rcsb.org/view/1ubq.pdb, ubq
```

### Related
[save](#save) · [loadall](#loadall) · [load_traj](#load_traj) · [fetch](#fetch) · [read_pdbstr](#read_pdbstr)

### Source
`importing.py:643-827`; format table `importing.py:1619-1644`. Parity: `load` ported in
`packages/engine-ts/src/cmd/fileio.ts` (PDB/CIF/MOL2/XYZ parsers); area marked done in feature-parity row 6.

---

## loadall

### Purpose
Load every file matching a shell glob pattern (evaluated on the server), optionally grouping the
results under one group object.

### Syntax
`loadall(pattern, group='', quiet=1, **kwargs)` — extra kwargs are forwarded to `load`.

### Behaviour
Globs on the server filesystem; each match becomes its own object, then (if `group` is given)
they are collected into a named group. Order follows the glob's sort.

### Examples
```
loadall frames/*.pdb, group=ensemble
```

### Related
[load](#load)

### Source
`importing.py:1513-1542`.

---

## load_traj

### Purpose
Append trajectory frames (as extra states) to an already-loaded molecular object. Supports the
VMD molfile trajectory formats (DCD, DTR, XTC, TRR, TRJ, CRD, NetCDF …).

### Syntax
`load_traj(filename, object='', state=1, format='', interval=1, average=1, start=1, stop=-1, max=-1, selection='all', image=1, shift='[0.0,0.0,0.0]', plugin='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | – | trajectory file |
| `object` | str | `''` | target molecular object (must already exist) |
| `state` | int | `1` | first state to populate; 0 = append after last |
| `format` | str | `''` | guess from extension |
| `interval` | int | `1` | take every Nth frame |
| `average` | int | `1` | average N frames (trj only, possibly broken) |
| `start` / `stop` | int | `1` / `-1` | frame range; stop −1 = all |
| `max` | int | `-1` | cap on states loaded |
| `selection` | str | `'all'` | subset of coordinates to load |
| `image` | 0/1 | `1` | residue-based periodic imaging (trj only) |
| `shift` | vec | `[0,0,0]` | translation applied per frame |
| `plugin` | str | `''` | VMD plugin name; guess from magic string |

### Behaviour
Rejects gzipped trajectories (must be uncompressed). Requires a pre-existing object; the GUI
dialog warns "you first need to load a molecular object". `defer_builds_mode=3` is recommended
for large trajectories.

### Examples
```
load 1x.pdb
load_traj md.xtc, 1x, start=1, stop=100, interval=5
```

### Related
[load](#load) · [load_coords](#load_coords)

### Source
`importing.py:341-459`.

---

## load_coords

### Purpose
API-only injection of an Nx3 coordinate array into a selection's atoms in a given state, in atom
**property-sorted** order.

### Syntax
`load_coords(coords, selection, state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `coords` | list | – | Nx3 float array |
| `selection` | str | – | atom selection |
| `state` | int | `1` | object state |

### Behaviour
Order matches `cmd.iterate` (sorted), which differs from `load_coordset`. Changed in 1.7.3 — this
symbol used to be `load_coordset`.

### Related
[load_coordset](#load_coordset)

### Source
`importing.py:1428`. Parity: ported in `packages/engine-ts/src/cmd/fileio.ts`.

---

## load_coordset

### Purpose
API-only injection of coordinates into an **object** in original (PDB file) atom order.

### Syntax
`load_coordset(coords, object, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `coords` | list | – | Nx3 float array |
| `object` | str | – | object name |
| `state` | int | `0` | state, or 0 to append |

### Behaviour
Loads in the untransformed source order (not the sorted order used by `load_coords`/`iterate`).

### Related
[load_coords](#load_coords)

### Source
`importing.py:1404`.

---

## load_object

### Purpose
Developer-level loader for a Python object (ChemPy model, CGO list, callback, brick, map) already
constructed in memory — no filesystem access.

### Syntax
`load_object(type, object, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | int | – | loadable enum (`loadable.model`, `loadable.cgo`, …) |
| `object` | obj | – | the in-memory object |
| `name` | str | – | destination object name |
| `state` | int | `0` | target state |
| `discrete` | int | `0` | discrete-state |

### Behaviour
The base primitive behind `load_cgo`/`load_model`/`load_callback`/`load_brick`/`load_map`, which
prepend the relevant `loadable.*` type token.

### Related
[load_cgo](#load_cgo) · [load_model](#load_model)

### Source
`importing.py:185`.

---

## load_embedded

### Purpose
Load a block of data previously declared inline in a `.pml` script via `embed`.

### Syntax
`load_embedded(key=None, name=None, state=0, finish=1, discrete=1, quiet=1, zoom=-1, multiplex=-2, object_props=None, atom_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `key` | str | `None` | embed key; None = most recent |
| `name` | str | `None` | object name |
| `state` | int | `0` | target state |
| `discrete` | int | `1` | discrete states |

### Behaviour
Reads from the embedded-data table built by the `embed`/`_default` parser directives, so scripts
can carry their own coordinates. Default `discrete=1` and `multiplex=-2`.

### Source
`importing.py:856-896`.

---

## load_model

### Purpose
Load a ChemPy `Indexed`/`Model` object into a new PyMOL object.

### Syntax
`load_model(model, object, state=0, finish=1, discrete=0)` — thin wrapper over `load_object`.

### Behaviour
Prepends `loadable.model` and forwards to `load_object`. The inverse of `get_model`.

### Related
[get_model](#get_model) · [load_object](#load_object)

### Source
`importing.py:327`.

---

## load_png

### Purpose
Load a PNG from disk and display it as the current rendered image (movie/overlay frame), not as a
molecular object.

### Syntax
`load_png(filename, movie=1, stereo=-1, quiet=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | – | PNG path |
| `movie` | 0/1 | `1` | store as a movie frame |
| `stereo` | int | `-1` | stereo handling |

### Behaviour
Blits the image into the display buffer; used to show pre-rendered frames or splash images.

### Related
[save](#save) (png export)

### Source
`viewing.py:1814-1834`.

---

## load_raw

### Purpose
API-only loader for content already in memory (bytes/str). Preferred over `format='…str'` on
`load`.

### Syntax
`load_raw(content, format, object='', state=0, finish=1, discrete=-1, quiet=1, multiplex=None, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `content` | str/bytes | – | the file contents |
| `format` | str | – | format token (`pdb`, `sdf`, `mol2`, `ccp4`, `mmtf`, …) |
| `object` | str | `''` | object name |

### Behaviour
If the format has a `…str` loadable it goes straight to memory; otherwise `load_raw` writes a
temp file and calls `load`. Ideal endpoint for browser uploads (no server path required).

### Examples
```python
cmd.load_raw(open("x.pdb").read(), "pdb", "x")
```

### Related
[read_pdbstr](#read_pdbstr) · [load](#load)

### Source
`importing.py:898-934`.

---

## load_cgo

### Purpose
Load a Compiled Graphics Object — a flat list of floats using the constants in `cgo.py` — as a
displayable geometry object.

### Syntax
`load_cgo(object, name, state=0, finish=1, discrete=0)` — wraps `load_object` with
`loadable.cgo`.

### Behaviour
The list is coerced to a Python list if needed, then handed to `load_object`.

### Related
[load_object](#load_object)

### Source
`importing.py:308`.

---

## fetch

### Purpose
Download a structure, map, or chemical component from the internet by accession code and load it,
caching it under `fetch_path`.

### Syntax
`fetch(code, name='', state=0, finish=1, discrete=-1, multiplex=-2, zoom=-1, type='', async_=0, path='', file=None, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `code` | str | – | one or more whitespace-separated accession codes |
| `name` | str | `''` | object name |
| `type` | str | `''` | `cif`, `bcif`, `pdb`, `pdb1`, `2fofc`, `fofc`, `emd`, `cid`, `sid`, `cc` |
| `async_` | 0/1 | `0` | download in background; `<0` = async when interactive |
| `path` | str | `''` | download dir (default: `fetch_path` setting or `.`) |
| `file` | str | `None` | explicit target filename |

### Behaviour
- `_multifetch` splits codes, infers `type` (2–3 char code → `cc` chemical component; else
  `fetch_type_default`, default `cif`), understands `EMD-xxxx`/`emd_xxxx`/`CID_`/`SID_`
  prefixes, and strips a trailing chain from 5+ char codes (post-filtered with `remove`).
- `_fetch` skips the download if the target file already exists, then tries each host in the
  `fetch_host` setting (default `pdb`; aliases `pdb`/`pdbe`/`pdbj`) crossed with per-type URL
  templates (mmtf, bio, pdb, cif, bcif, 2fofc, fofc, pubchem, emd, cc). An HTML body is treated
  as a failure.
- Log rewriting appends `async=0` to `fetch` lines so replayed logs are deterministic.
- **Sources**: RCSB/PDB, PDBe, PDBj (structures & maps), EMDB (`emd`), PubChem (`cid`/`sid`),
  and the wwPDB chemical-component dictionary (`cc`).

### Examples
```
fetch 1ubq
fetch 1abc, type=2fofc
fetch emd_1234, type=emd
```

### Related
[download_chem_comp](#download_chem_comp) · [fetch_path](#fetch_path) · [load](#load)

### Source
`importing.py:1331-1402` (`_multifetch` `:1274-1329`, `_fetch` `:1155-1272`).

---

## fetch_path

### Purpose
Setting that names the directory `fetch` writes downloaded files into.

### Behaviour
Default `"."` (special-cased in `Setting.cpp:644`). `download_chem_comp` also caches ligand CIFs
here and warns when it is read-only. Companion settings: `fetch_host` (default `pdb`),
`fetch_type_default` (default `cif`).

### Source
`SettingInfo.h:607`. Default: `"."`.

---

## download_chem_comp

### Purpose
Download (and cache) a wwPDB chemical-component-dictionary CIF for a residue/ligand code.

### Syntax
`download_chem_comp(resn, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `resn` | str | – | 3-letter component code |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Caches the CIF under `fetch_path`; if that directory is read-only it warns and uses a temp
location. Returns the local path (used by builders that need ideal ligand geometry).

### Related
[fetch](#fetch)

### Source
`internal.py:311-338`.

---

## save

### Purpose
The universal writer: writes a selection (or session, map, alignment, image, geometry) to a file,
choosing the format from the extension.

### Syntax
`save(filename, selection='(all)', state=-1, format='', ref='', ref_state=-1, quiet=1, partial=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | – | output path |
| `selection` | string | `'(all)'` | atoms to save |
| `state` | int | `-1` | state (−1 = current, 0 = all) |
| `format` | str | `''` | override; else guessed from extension |
| `ref` / `ref_state` | | `''` / `-1` | reference frame object/state |
| `partial` | int | `0` | partial save (session) |

### Behaviour
- **Unrecognised extensions raise "Unrecognized file format"** — despite the docstring still
  claiming a PDB fallback.
- `.pse`/`.psw` set the `session_file` setting (backslashes normalised to `/`).
- Object formats route through `func_type4`: `mmd/out/dat`→`mmod`, `pkl` (binary pickle),
  `pkla` (ascii pickle).
- Everything else dispatches through `savefunctions`; a handler taking `filename` writes the file
  itself, otherwise the returned str/bytes are written here, honouring `.gz`/`.bz2`.

### Examples
```
save out.pdb, chain A
save session.pse
save map.ccp4, mymap
```

### Related
[load](#load) · [multisave](#multisave) · [get_pdbstr](#get_pdbstr) · [session format](#session-format-pse--psw)

### Source
`exporting.py:784-935`; handler table `:988-1020`.

---

## multisave

### Purpose
Write a **multi-entry** PDB/CIF file where each object in the selection gets its own HEADER (and
CRYST) block terminated by END — so reloading splits it back into separate objects.

### Syntax
`multisave(filename, pattern='all', state=-1, append=0, format='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | – | output path |
| `pattern` | str | `'all'` | atom selection (spanning objects) |
| `state` | int | `-1` | −1 = current, 0 = all |
| `append` | 0/1 | `0` | append to existing file |
| `format` | str | `''` | guess from ext, else `pdb` |

### Behaviour
PDB and CIF only. Rejects `.gz`/`.bz2`. `.pmo` is explicitly rejected. Contrast with `save`,
which writes a multi-object selection "flat" without per-object HEADER/CRYST records.

### Related
[save](#save) · [multifilesave](#multifilesave)

### Source
`exporting.py:604-657`. Parity: ported in `packages/engine-ts/src/cmd/exporters.ts`.

---

## multifilesave

### Purpose
Save a selection spanning multiple objects and/or states to **one file per object/state**, using
placeholder-templated filenames.

### Syntax
`multifilesave(filename, selection='*', state=-1, format='', ref='', ref_state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | – | template with placeholders |
| `selection` | str | `'*'` | atoms to save |
| `state` | int | `-1` | −1 current, 0 all |

### Behaviour
Placeholders: `{name}` object name, `{state}` state number, `{title}` state title, `{num}` file
number, `{}` = object name (first `{}`) then state (second `{}`). `{state}`/`{num}` are
zero-padded.

### Examples
```
multifilesave frame_{state}.pdb, mymol, state=0
multifilesave {name}.pdb, all
```

### Related
[multifilenamegen](#multifilenamegen) · [multisave](#multisave)

### Source
`exporting.py:707-732`. Parity: ported in `packages/engine-ts/src/cmd/exporters.ts`.

---

## multifilenamegen

### Purpose
API helper that expands a placeholder filename template into the concrete
`(filename, selection, state)` triples `multifilesave` would write — used by the GUI to pre-flight
a per-file save-dialog loop.

### Syntax
`multifilenamegen(filename, selection, state)`

### Behaviour
Same placeholder grammar as `multifilesave` (`{name} {state} {title} {num} {}`), one triple per
object/state.

### Related
[multifilesave](#multifilesave)

### Source
`exporting.py:735-781`.

---

## get_session

### Purpose
Build the in-memory session dictionary (camera, objects, settings, scenes, movie) — the payload
behind `.pse` saving.

### Syntax
`get_session(names='', partial=0, quiet=1, compress=-1, cache=-1, binary=-1, version=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `names` | str | `''` | restrict to named objects (else all) |
| `partial` | int | `0` | partial session |
| `compress` | int | `-1` | deprecated `session_compression` |
| `binary` | int | `-1` | `pse_binary_dump` |
| `version` | int | `-1` | `pse_export_version` (back-ports legacy) |

### Behaviour
Honours `pse_export_version` (backports settings/objects via `_session_convert_legacy`),
`pse_binary_dump`, `session_cache_optimize` (→ `cache('optimize')`), and runs
`_session_save_tasks` hooks. `session_compression` is deprecated and now warns.

### Related
[set_session](#set_session) · [session format](#session-format-pse--psw)

### Source
`exporting.py:371-476`. Parity: ported in `packages/engine-ts/src/cmd/exporters.ts`.

---

## set_session

### Purpose
Restore a session dictionary (or its zlib+pickle bytes) into the current PyMOL instance — the
payload behind `.pse` loading.

### Syntax
`set_session(session, partial=0, quiet=1, cache=1, steal=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `session` | dict/bytes | – | session payload |
| `partial` | int | `0` | merge instead of replace |
| `cache` | int | `1` | restore cache |
| `steal` | int | `-1` | steal (take ownership of) cache |

### Behaviour
Accepts bytes (zlib+pickle) or a dict; restores `pymol.session`/`_cache`, runs
`_session_restore_tasks`, and **activates the `security` wizard when the session contains movie
commands** — a modal accept/decline gate against embedded command execution.

### Related
[get_session](#get_session)

### Source
`importing.py:138-183`. Parity: ported in `packages/engine-ts/src/cmd/exporters.ts`.

---

## session format (.pse / .psw)

### Purpose
PyMOL's native, complete workspace format: a pickled session dictionary (camera, every object,
all reps/colors/visibility, settings, scenes, movie).

### Behaviour
- Serialisation: `get_psestr` → `get_session` → `cPickle.dumps(session, 1)`
  (`exporting.py:975-979`). `.pze`/`.pzw` are the gzip variants.
- `.pse` and `.psw` carry **identical content**; only the extension differs. `.psw` (PyMOL Show)
  auto-starts presentation mode — on load it rewinds the movie and recalls the first scene, and
  the GUI enters full-screen presentation chrome.
- **PNG embedding**: a session can carry an embedded preview/thumbnail PNG (session thumbnails),
  and `.psw` presentation state includes the rendered first-scene image.
- Loading (`load_pse`, `importing.py:829-854`): read via `file_read`, unpickle,
  `set_session(steal=1)`, set `session_file`, and for `.psw` (or `presentation` +
  `presentation_auto_start`) rewind + recall scene 1.
- Security: `.pse` files with movie commands trigger the `security` wizard on restore.

### Related
[save](#save) · [get_session](#get_session) · [set_session](#set_session)

### Source
`exporting.py:975-979`, `importing.py:829-854`.

---

## log_open

### Purpose
Open a log file and start recording every executed command to it.

### Syntax
`log_open(filename='log.pml', mode='w')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | `'log.pml'` | `.pml` or `.py` output |
| `mode` | w/a | `'w'` | `w` fresh file, `a` append |

### Behaviour
Holds an open `LogFile` handle for the session; sets `logging=2` for `.py`/`.pym`, else `1`.
Append mode writes a leading newline. Can also log to a Queue object. `LogFile.write` rewrites
`fetch …` lines to append `async=0`.

### Related
[log](#log) · [log_close](#log_close)

### Source
`commanding.py:107-155`.

---

## log

### Purpose
Write one command line into the open log file, in either pml or python form.

### Syntax
`log(text, alt_text=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `text` | str | – | PyMOL command (must include trailing newline) |
| `alt_text` | str | `None` | Python-form equivalent |

### Behaviour
`text` and/or `alt_text` must include the terminating line feed. Which form is written depends on
the `logging` mode set by `log_open`.

### Related
[log_open](#log_open) · [log_close](#log_close)

### Source
`commanding.py:160-204`.

---

## log_close

### Purpose
Close the current log file and stop recording.

### Syntax
`log_close()`

### Behaviour
Closes the handle and does `set logging, 0`. No-op if no log is open.

### Related
[log_open](#log_open) · [log](#log)

### Source
`commanding.py:206-227`.

---

## run

### Purpose
Execute a Python or PyMOL-command script file in the running instance.

### Syntax
`run(filename, namespace=None)` — namespace one of `local/global/module/main/private`.

### Behaviour
`.pml` files are delegated to `cmd.load` (parsed as command script); `.py`/`.pym` are executed as
Python in the chosen namespace. The GUI's Run Script does `cmd.cd(dirname)` first.

### Examples
```
run analysis.py
```

### Related
[spawn](#spawn) · [@ (command-script include)](#-command-script-include)

### Source
`parsing.py:427-470`.

---

## spawn

### Purpose
Launch a Python script in a new thread, running concurrently with the interpreter.

### Syntax
`spawn(filename, namespace='module')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | – | Python script |
| `namespace` | str | `'module'` | `module` (own), `local`, or `global` |

### Behaviour
Non-blocking sibling of `run` for long-running or background scripts.

### Related
[run](#run)

### Source
`parsing.py` (`spawn` variant); doc `commands.mdx:3859`.

---

## @ (command-script include)

### Purpose
The `@file.pml` directive: inline-include and execute a PyMOL command script.

### Syntax
`@<filename>`

### Behaviour
Opens the file and nests one parser layer. `.p1m`/`.pim` force secure mode. Using `@` on a Python
file warns "use 'run' instead of '@' with Python files?". `.pml` files loaded through the GUI go
through `cmd.do("@" + fname)`.

### Related
[run](#run)

### Source
`parser.py:403-441`.

---

## get_pdbstr

### Purpose
API-only: return the PDB text for a selection/state without writing a file — ideal for browser
download or round-tripping.

### Syntax
`get_pdbstr(selection='all', state=-1, ref='', ref_state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | atoms to export |
| `state` | int | `-1` | −1 = current state |
| `ref` / `ref_state` | | `''` / `-1` | reference frame |

### Behaviour
Column layout mirrors `CoordSetAtomToPDBStrVLA`, so `parsePdb(get_pdbstr(...))` round-trips.

### Related
[read_pdbstr](#read_pdbstr) · [get_cifstr](#get_cifstr) · [save](#save)

### Source
`exporting.py:222`. Parity: ported in `packages/engine-ts/src/cmd/fileio.ts`.

---

## get_fastastr

### Purpose
API-only: return protein/nucleic sequences in FASTA format (used by `save foo.fasta`).

### Syntax
`get_fastastr(selection='all', state=-1, quiet=1, key='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | reduced to `guide & alt +A` |
| `state` | int | `-1` | only used if `> 0` |
| `key` | str | `''` | python expression for the header (default `model + "_" + chain`) |

### Behaviour
Chain-specific keys and nucleic-acid support added in 2.2. `quiet` is unused.

### Related
[save](#save)

### Source
`exporting.py:170-220`. Parity: ported in `packages/engine-ts/src/cmd/fileio.ts`.

---

## get_cifstr

### Purpose
API-only: return an mmCIF string for a selection/state.

### Syntax
`get_cifstr(selection='all', state=-1, quiet=1)`

### Behaviour
The CIF analogue of `get_pdbstr`; feeds `save *.cif` and browser download.

### Related
[get_pdbstr](#get_pdbstr)

### Source
`exporting.py:937`. Parity: ported in `packages/engine-ts/src/cmd/exporters.ts`.

---

## get_model

### Purpose
API-only: return a ChemPy `Indexed` model (atoms, bonds, coordinates) for a selection — the
programmatic inverse of `load_model`.

### Syntax
`get_model(selection='(all)', state=1, ref='', ref_state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms |
| `state` | int | `1` | state to read |
| `ref` / `ref_state` | | `''` / `0` | reference frame |

### Behaviour
Returns a full object graph you can mutate and reload via `load_model`.

### Related
[load_model](#load_model)

### Source
`querying`/`exporting`; doc `commands.mdx:1320`.

---

## read_pdbstr

### Purpose
API-only: load/update a structure from a PDB string — no temp file.

### Syntax
`read_pdbstr(contents, oname, state=0, finish=1, discrete=0, quiet=1, zoom=-1, multiplex=-2, object_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `contents` | str | – | PDB text |
| `oname` | str | – | object name |
| `state` | int | `0` | target state |

### Behaviour
The handler `load` uses for `.pdb` files; can append into an existing object (update coordinates).

### Related
[get_pdbstr](#get_pdbstr) · [load_raw](#load_raw)

### Source
`importing.py:1008`.

---

## read_molstr

### Purpose
API-only: load an MDL MOL structure from a string.

### Syntax
`read_molstr(molstr, name, state=0, finish=1, discrete=1, quiet=1, zoom=-1)`

### Behaviour
Single-record MOL loader; `discrete=1` by default.

### Related
[read_sdfstr](#read_sdfstr)

### Source
`importing.py:965`. Parity: ported in `packages/engine-ts/src/cmd/fileio.ts` / `exporters.ts`.

---

## read_sdfstr

### Purpose
API-only: load an MDL SD (multi-record MOL) structure from a string.

### Syntax
`read_sdfstr(sdfstr, name, state=0, finish=1, discrete=1, quiet=1, zoom=-1, multiplex=-2, object_props=None)`

### Behaviour
SDF variant of `read_molstr`; `multiplex=-2` splits records.

### Related
[read_molstr](#read_molstr)

### Source
`importing.py:936`. Parity: ported in `packages/engine-ts/src/cmd/fileio.ts`.

---

## read_mmodstr

### Purpose
API-only: load a MacroModel structure from a string.

### Syntax
`read_mmodstr(content, name, state=0, quiet=1, zoom=-1)`

### Behaviour
MacroModel (`mmod`) string loader; the read side of the `save *.mmd` path.

### Source
`importing.py:995`.

---

## read_xplorstr

### Purpose
API-only: load an XPLOR map from a string, bypassing temp files.

### Syntax
`read_xplorstr(xplor, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)`

### Behaviour
Loads XPLOR-format volumetric data as a map object directly from memory.

### Source
`importing.py:1074`.
