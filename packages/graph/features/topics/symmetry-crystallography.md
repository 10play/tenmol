---
name: symmetry-crystallography
kind: feature
category: symmetry
subcategory: crystal symmetry & assemblies
summary: The crystallographic corner of PyMOL — reading/writing a molecule's unit cell and space group, generating symmetry mates within a cutoff, drawing the unit-cell box, wrapping/unwrapping periodic images, and building biological assemblies.
parity: partial
---

## Purpose

A crystallographic model carries a **unit cell** (six lattice parameters `a b c α β γ`) and a
**space group** whose symmetry operators tile that cell through all of space. This domain is the set
of commands and settings that read, write, and exploit that information: inspecting the cell
(`get_symmetry`), defining or copying it (`set_symmetry`, `symmetry_copy`), regenerating the
crystal packing around a region of interest (`symexp`), drawing the cell box (the `cell`
representation), handling periodic-boundary trajectories (`pbc_wrap` / `pbc_unwrap`), and enumerating
biological assemblies from mmCIF (`get_assembly_ids`, the `assembly` setting). You reach for it
whenever you care about crystal contacts, packing, or the true biological oligomer rather than the
asymmetric unit as deposited.

## Syntax

The engine builds the standard PDB/CCP4 orthogonalisation matrix `M` (fractional → Cartesian) from
the cell; a symmetry mate is `cart' = M·(R·(Minv·cart) + t + L)` where `(R, t)` is a space-group
operator in fractional coordinates and `L` an integer lattice translation. The commands below sit on
top of that machinery.

---

## symexp

`symexp(prefix, object, selection, cutoff, segi=0, quiet=1)` — create all symmetry-related objects
of `object` that fall within `cutoff` Å of `selection`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prefix` | str | | name stem for the new objects; each mate becomes `prefix##` |
| `object` | str | | the crystallographic object to expand (must carry a cell) |
| `selection` | str | | atoms the mates must come within `cutoff` of |
| `cutoff` | float | | proximity threshold in Å |
| `segi` | int | `0` | tag each mate's atoms with a distinct segment identifier |
| `quiet` | int | `1` | suppress console output |

### Behaviour

For every space-group operator and every integer lattice translation in a window sized by the cell
and cutoff, `symexp` transforms the object's coordinates and keeps the image only if at least one of
its atoms lies within `cutoff` of the selection. Each surviving mate is materialised as a fresh
object (atoms, bonds, and the cell are copied; coordinates are transformed for **every** state) and
named `prefix` + a zero-padded counter. The source copy — identity operator, zero lattice
translation — is skipped, so you never get a duplicate of the input. The object must have a cell and
at least one atom, and the selection must match at least one atom, or the result is empty. In upstream
PyMOL the new objects are additionally labelled with their crystallographic symmetry-operation and
translation code; the TS port names them `prefix00`, `prefix01`, … only.

## symmetry_copy

`symmetry_copy(source_name, target_name, source_state=1, target_state=1, quiet=1)` — copy the crystal
and space-group parameters from one object to another.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `source_name` | str | | object to read symmetry from |
| `target_name` | str | | object-name pattern to write symmetry to |
| `source_state` | int | `1` | source object state (maps only) |
| `target_state` | int | `1` | target object state (maps only) |
| `quiet` | int | `1` | suppress console output |

### Behaviour

Copies the cell and space group from source to target. Per-state symmetry is meaningful only for map
objects; molecular objects don't support individual states yet, so the state arguments are effectively
ignored for molecules. Useful when a companion object (e.g. a map or an edited copy) has lost or never
had its cell.

## get_symmetry

`get_symmetry(selection='(all)', state=-1, quiet=1)` — return the crystal and space-group parameters
of a molecule or map.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | object name or selection; the first matched object is used |
| `state` | int | `-1` | object state to query (`-1` = current) |
| `quiet` | int | `1` | when `0`, prints the cell and space group |

### Behaviour

Returns a 7-element list `[a, b, c, alpha, beta, gamma, spacegroup]`, or `None`/empty when no symmetry
is defined. When `quiet=0` it prints the A/B/C, Alpha/Beta/Gamma and SpaceGroup lines. The space group
defaults to `'P 1'` if the object has a cell but no recorded group.

## set_symmetry

`set_symmetry(selection, a, b, c, alpha, beta, gamma, spacegroup='P1', state=-1, quiet=1)` — define or
redefine the crystal and space-group parameters.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | | object-name pattern to modify |
| `a` `b` `c` | float | | cell edge lengths (Å) |
| `alpha` `beta` `gamma` | float | | cell angles (degrees) |
| `spacegroup` | str | `'P1'` | Hermann–Mauguin space-group symbol |
| `state` | int | `-1` | object state (maps only) |
| `quiet` | int | `1` | suppress console output |

### Behaviour

Writes the six cell parameters and the space-group string onto the object. All six lattice values must
be finite numbers or the write is rejected. If `spacegroup` is omitted it keeps the object's existing
group (or `P 1`). This is the command you use to give an object a cell before `symexp` or before
showing the `cell` representation.

## cell

**Representation** (`show cell`, `hide cell`) — draws the crystallographic unit-cell box.

### Behaviour

The `cell` rep renders the unit cell as a wireframe: the eight corners of the fractional unit cube
`(0/1, 0/1, 0/1)` are mapped through the orthogonalisation matrix to Cartesian space and the twelve
edges are drawn as lines — this doubles as a display of the cell **axes** (the a/b/c edges meeting at
the origin corner). It is only produced when the object has a cell and at least one atom carries the
cell rep bit. Two settings tune it (below): `cell_color` recolours the box and `cell_centered` shifts
it so the cell is centred on the origin rather than anchored at the `(0,0,0)` corner. The TS port draws
the box in white and does not yet honour `cell_color` or `cell_centered`.

## pbc_wrap

`pbc_wrap(oname, center=None)` — wrap molecules into the periodic (PBC) box.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `oname` | str | | object name |
| `center` | list \| None | `None` | box centre in model space; `None` = average of the first coordinate state |

### Behaviour

Shifts each molecule by whole lattice vectors so its centre lands inside the periodic box centred at
`center`. Intended for MD trajectories where atoms have drifted out of the primary cell. In the TS
engine this is currently a registered no-op (no coordinate change).

## pbc_unwrap

`pbc_unwrap(oname, bymol=True)` — unwrap atoms/molecules so they stop jumping across periodic
boundaries.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `oname` | str | | object name |
| `bymol` | 0/1 | `1` | unwrap whole molecules (`1`) rather than individual atoms (`0`) |

### Behaviour

The inverse of `pbc_wrap`: makes trajectory coordinates continuous across the periodic boundary so a
molecule that crossed the box edge is drawn intact instead of split. With `bymol=1` an entire molecule
moves as a unit. In the TS engine this is currently a registered no-op.

## get_assembly_ids

`get_assembly_ids(name, quiet=1)` — list the biological-assembly ids of an mmCIF-loaded object.
**EXPERIMENTAL AND SUBJECT TO CHANGE.**

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | object loaded from mmCIF |
| `quiet` | int | `1` | when `0`, prints the ids |

### Behaviour

Reads the `_pdbx_struct_assembly.id` array from the object's stored mmCIF and returns it as a list of
strings (e.g. `['1', '2']`); returns empty/None if there is no such data. These ids are what you feed
to the `assembly` setting before loading a structure to have PyMOL build the biological assembly. The
TS port is a stub that always returns `[]`.

## assembly

**Setting** (string, default `''`) — selects which biological assembly to generate when loading an
mmCIF file.

### Behaviour

When set to an assembly id (e.g. `set assembly, 1`) before `load`/`fetch`, PyMOL applies the
`_pdbx_struct_assembly_gen` operators from the mmCIF and builds the biological oligomer rather than the
asymmetric unit. An empty string (the default) loads the deposited coordinates as-is. The Get-PDB
fetch dialog and the mmCIF settings menu drive this as an on=`'1'`/off=`''` toggle. Assembly
generation is not yet ported in the TS engine.

## space groups

**Feature** — the table of Hermann–Mauguin space groups whose symmetry operators the engine knows.

### Behaviour

`symexp` (and any cell-aware operation) needs the list of `(R, t)` operators for the object's space
group. Upstream PyMOL ships the full crystallographic space-group table. The TS parity port embeds
operator sets for a small set of low-symmetry groups — **P1**, **P2₁** (`P1211`), **P2** (`P121`),
**P2₁2₁2₁**, and **C2** (`C121`) — and falls back to a bare identity (P1) operator for any unrecognised
symbol. So symmetry-mate expansion is exact for those groups and degrades to lattice-only translations
otherwise. Space-group symbols are matched case-insensitively with whitespace stripped.

## cell_color

**Setting** (color, default `-1`, object-state scope) — the colour of the `cell` representation box.

### Behaviour

`-1` means "use the object's colour". Any other colour index recolours the unit-cell wireframe.
Changing it invalidates the cell rep's colour. Not yet honoured by the TS cell-rep builder (which draws
white).

## cell_centered

**Setting** (boolean, default `false`, global) — centre the unit-cell box on the origin.

### Behaviour

When `true`, the drawn cell box is translated so the cell is centred on the coordinate origin instead
of anchored with one corner at `(0,0,0)`. Changing it invalidates the cell rep geometry. Not yet
honoured by the TS cell-rep builder.

## Examples

```python
# Generate crystal contacts within 5 Å of chain A, then show them
load 1abc.cif, xtal
symexp sym_, xtal, (xtal and chain A), 5.0
show cell, xtal
```

```python
# Give an object a cell and space group by hand, then read it back
set_symmetry mol, 68.4, 68.4, 105.2, 90, 90, 120, P43212
print(cmd.get_symmetry("mol"))   # -> [68.4, 68.4, 105.2, 90.0, 90.0, 120.0, 'P43212']
```

```python
# Build biological assembly 1 of an mmCIF entry
set assembly, 1
fetch 3j3q, type=cif
```

## Related

- [selection-algebra](../topics/selection-algebra.md) — the `selection` argument to `symexp` and the `symop` selector for symmetry-related atoms.
- `create` / `load` — how new objects (including symexp mates and assemblies) enter the session.

## Source

- `symexp`: `packages/engine/modules/pymol/creating.py:909`; `docs/api-reference/commands.mdx:3967`; TS port `packages/engine-ts/src/cmd/symmetry.ts`.
- `symmetry_copy`, `set_symmetry`, `pbc_wrap`, `pbc_unwrap`: `packages/engine/modules/pymol/editing.py:412,379,328,312`.
- `get_symmetry`, `get_assembly_ids`: `packages/engine/modules/pymol/querying.py:147,1606`.
- `cell` rep: `packages/engine/layer2/CoordSet.cpp:1265`; TS `packages/engine-ts/src/geometry/cell.ts`.
- Settings: `packages/engine/layer1/SettingInfo.h:897 (cell_color), :898 (cell_centered), :857 (assembly)`; invalidation `packages/engine/layer1/Setting.cpp:2479,2736`.
- Parity note: `get_symmetry`, `set_symmetry`, `symmetry_copy`, `symexp` and the `cell` rep are ported in TypeScript; the space-group table is limited to P1/P2₁/P2/P2₁2₁2₁/C2; `pbc_wrap`/`pbc_unwrap` are registered no-ops; `get_assembly_ids` is a stub; assembly generation and `cell_color`/`cell_centered` are not yet honoured.
