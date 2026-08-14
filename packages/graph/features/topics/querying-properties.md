---
name: querying-properties
kind: feature
category: querying
subcategory: introspection & properties
summary: Introspection, per-atom iteration, coordinate/geometry queries, object/selection listing, and object- and atom-level custom properties.
parity: implemented
---

# Querying & Properties

The querying domain is how you *read* structure out of PyMOL: walk atoms with a
Python expression (`iterate`/`alter`), pull coordinates and geometry
(`get_coords`, `get_extent`, `get_area`, `get_distance`/`get_angle`/`get_dihedral`,
`get_phipsi`), enumerate objects and their metadata (`get_names`, `get_type`,
`get_chains`, `get_symmetry`, `get_title`, `count_*`), map selections to stable
identifiers (`identify`, `index`, `id_atom`), and attach/read custom object- and
atom-level properties (`get_property`, `set_property`, `set_atom_property`).

Upstream implementations live in `packages/engine/modules/pymol/querying.py`,
`packages/engine/modules/pymol/properties.py`, and (for the iteration family)
`packages/engine/modules/pymol/editing.py`.

Two conventions run through the whole domain:

- **State indexing.** The Python API takes 1-based `state` and passes
  `int(state) - 1` to the C layer. `state=0` means *all states* and `state=-1`
  means *current state*. Watch the per-command default: it is `1` for
  coordinate getters, `0`/all for `count_atoms`/`get_extent`/`get_chains`, and
  `-1`/current for the geometry getters.
- **`quiet`.** Most getters accept `quiet=1` (default). Set `quiet=0` to also
  print the human-readable result to the log; the return value is unchanged.

---

## iterate

Iterate over an expression within a temporary namespace for each atom, **read
only**. Use it to collect atom data into Python without mutating the model.

### Syntax
`iterate(selection, expression=None, quiet=1, space=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | atoms to visit |
| `expression` | str | `None` | Python statement evaluated per atom; if omitted, returns a `partial` awaiting the expression |
| `quiet` | int | `1` | suppress log output |
| `space` | dict | `None` | namespace for names referenced by the expression (defaults to `pymol` module dict) |

### Behaviour
The expression is evaluated once per atom with the atom-namespace symbols in
scope (see [atom-namespace](#atom-namespace)). Unlike `alter`, assignments to
atomic symbols do not persist. Accumulate into an external object via `space`
(commonly `stored`) or a passed dict. Since PyMOL 2.5 the expression may instead
be a Python callable receiving a `namespace` object. Atoms are visited in the
object's sorted atom order.

### Examples
```python
stored.names = []
iterate all, stored.names.append(name)

# Python-callback form
names = []
cmd.iterate("all", lambda atom: names.append(atom.name))
```

### Related
[alter](#alter), [iterate_state](#iterate_state), [atom-namespace](#atom-namespace)

### Source
`packages/engine/modules/pymol/editing.py:1773`; parity: implemented in
`packages/engine-ts/src`.

---

## iterate_state

Iterate over an expression per atom *coordinate* in a given state, read only.
The state-aware counterpart of `iterate`.

### Syntax
`iterate_state(state, selection, expression, quiet=1, space=None, atomic=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `state` | int | — | 1-based state (0=all, -1=current) |
| `selection` | str | — | atoms to visit |
| `expression` | str | — | Python statement evaluated per atom-coordinate |
| `quiet` | int | `1` | suppress log output |
| `space` | dict | `None` | namespace for referenced names |
| `atomic` | int | `1` | expose atom symbols in addition to `x/y/z` |

### Behaviour
Adds per-state coordinate symbols `x`, `y`, `z` to the namespace. With
`atomic=1` (default) the read-only atomic symbols are also available. Read only:
assignments to `x/y/z` are discarded (use `alter_state` to move atoms).

### Examples
```python
stored.sum_x = 0.0
iterate_state 1, all, stored.sum_x = stored.sum_x + x
```

### Related
[alter_state](#alter_state), [iterate](#iterate), [get_coords](#get_coords)

### Source
`packages/engine/modules/pymol/editing.py:1864`; parity: implemented.

---

## alter

Change atomic properties using an expression evaluated in a temporary namespace
for each atom. The read/write counterpart of `iterate`.

### Syntax
`alter(selection, expression, quiet=1, space=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | atoms to modify |
| `expression` | str | — | Python statement evaluated (and applied) per atom |
| `quiet` | int | `1` | suppress log output |
| `space` | dict | `None` | namespace for referenced names |

### Behaviour
Assignments to writable atom symbols (`name`, `resn`, `resi`, `chain`, `b`, `q`,
`elem`, `partial_charge`, `formal_charge`, `ss`, `color`, `flags`, …) persist to
the model. Strings must be explicitly quoted. **Always run `sort` afterward** if
you changed a property that affects canonical atom ordering (names, chains,
resi), or subsequent `create`/`byres` will misbehave. You often need `rebuild`
to refresh representations. Read-only symbols (`model`, `state`, `index`) cannot
be assigned. Operation is roughly seconds-per-thousand-atoms.

### Examples
```python
alter chain A, chain='B'
alter all, resi=str(int(resi)+100)
sort
```

### Related
[alter_state](#alter_state), [iterate](#iterate), [set_atom_property](#set_atom_property), [atom-namespace](#atom-namespace)

### Source
`packages/engine/modules/pymol/editing.py:1708`; parity: implemented.

---

## alter_state

Change atom coordinates and flags for a particular state and selection using the
Python evaluator with a temporary namespace for each atomic coordinate.

### Syntax
`alter_state(state, selection, expression, quiet=1, space=None, atomic=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `state` | int | — | 1-based state (0=all, -1=current) |
| `selection` | str | — | atoms to modify |
| `expression` | str | — | Python statement applied per atom-coordinate |
| `quiet` | int | `1` | suppress log output |
| `space` | dict | `None` | namespace for referenced names |
| `atomic` | int | `1` | expose read-only atom symbols alongside `x/y/z` |

### Behaviour
Exposes writable `x`, `y`, `z` (and, with `atomic=1`, read-only atom symbols).
Assignments to `x/y/z` move the atom in that state. Call `rebuild` afterward to
update representations.

### Examples
```python
alter_state 1, all, x=x+5
rebuild
```

### Related
[iterate_state](#iterate_state), [alter](#alter)

### Source
`packages/engine/modules/pymol/editing.py:1821`; parity: implemented.

---

## atom-namespace

The set of per-atom symbols exposed to `iterate`/`alter` (and, with `atomic=1`,
to `iterate_state`/`alter_state`). Not a command — a shared vocabulary.

### Behaviour
Available symbols (`*` = read only):

`name`, `resn`, `resi`, `resv`, `chain`, `segi`, `elem`, `alt`, `q`, `b`, `vdw`,
`type`, `partial_charge`, `formal_charge`, `elec_radius`, `text_type`, `label`,
`numeric_type`, `model*`, `state*`, `index*`, `ID`, `rank`, `color`, `ss`,
`cartoon`, `flags`.

`iterate_state`/`alter_state` additionally expose the coordinate triple `x`,
`y`, `z`. Custom atom properties set with [set_atom_property](#set_atom_property)
are reachable via the `p` object (e.g. `p.myprop`) and atom-state settings via
`s`. In `iterate`/`iterate_state` all symbols are effectively read only; in
`alter`/`alter_state` the non-starred symbols (and `x/y/z` in state form) are
writable.

### Related
[iterate](#iterate), [alter](#alter), [set_atom_property](#set_atom_property)

### Source
`packages/engine/modules/pymol/editing.py:1730` (alter docstring symbol list).

---

## get_model

Return a ChemPy `Indexed`-format model (atoms, coords, bonds) for a selection.

### Syntax
`get_model(selection='(all)', state=1, ref='', ref_state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to export |
| `state` | int | `1` | source state |
| `ref` | str | `''` | object whose frame defines the reference |
| `ref_state` | int | `0` | state of `ref` |

### Behaviour
Returns a `chempy.models.Indexed` with `.atom` (per-atom objects carrying
`name`, `resn`, `coord`, `q`, `b`, …) and `.bond`. `centerofmass` and many
scripts build on this. Coordinates are taken from `state`.

### Examples
```python
model = cmd.get_model("polymer and name CA")
print(len(model.atom))
```

### Related
[get_coords](#get_coords), [get_atom_coords](#get_atom_coords)

### Source
`packages/engine/modules/pymol/querying.py:1060`; parity: implemented.

---

## get_coords

API-only: get selection coordinates as a NumPy array.

### Syntax
`get_coords(selection='all', state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | atom selection |
| `state` | int | `1` | state index, or all states if `state=0` |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns an `(N, 3)` float array (or `None` if empty). With `state=0` the array
stacks all states. Order follows sorted atom order.

### Related
[get_coordset](#get_coordset), [get_atom_coords](#get_atom_coords)

### Source
`packages/engine/modules/pymol/querying.py:904`; parity: implemented.

---

## get_coordset

API-only: get one object's coordinate set as a NumPy array.

### Syntax
`get_coordset(name, state=1, copy=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | object name |
| `state` | int | `1` | state index |
| `copy` | 0/1 | `1` | `0` returns a wrapper of internal memory (unsafe if freed/reallocated) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Unlike `get_coords`, `name` must be a single object (not a selection expression)
and returns that object's raw coordinate set in stored atom order. Use
`copy=0` only when you know the memory will outlive the array.

### Related
[get_coords](#get_coords), [get_model](#get_model)

### Source
`packages/engine/modules/pymol/querying.py:921`; parity: implemented.

---

## get_atom_coords

Return the 3D coordinates of a single atom.

### Syntax
`get_atom_coords(selection, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | must resolve to exactly one atom |
| `state` | int | `0` | state (Python passes `state-1`; default resolves to current) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Low-performance path for a single atom; raises if the selection is empty or
matches multiple atoms. Returns a 3-float list `[x, y, z]`.

### Related
[get_coords](#get_coords), [get_position](#get_position-note)

### Source
`packages/engine/modules/pymol/querying.py:888`; parity: implemented.

---

## get_extent

Return the min/max XYZ bounding box of a selection.

### Syntax
`get_extent(selection='(all)', state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to bound |
| `state` | int | `0` | state (default all) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns `[[min-x, min-y, min-z], [max-x, max-y, max-z]]`. Backed by the C
`get_min_max` routine. Feeds camera/zoom logic and `centerofmass`.

### Examples
```python
(mn, mx) = cmd.get_extent("chain A")
```

### Related
[centerofmass](#centerofmass-note), [get_area](#get_area)

### Source
`packages/engine/modules/pymol/querying.py:1378`; parity: implemented.

---

## get_area

Get the molecular surface area of a selection.

### Syntax
`get_area(selection='(all)', state=1, load_b=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to measure |
| `state` | int | `1` | state |
| `load_b` | bool | `0` | store per-atom area into b-factors |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Depends on the **`dot_solvent`** setting: with `dot_solvent=off` (default) it
computes the solvent-*excluded* surface area, otherwise the solvent-*accessible*
area. Precision follows the `dot_density` setting. `load_b=1` writes each atom's
contribution into its b-factor for later `iterate`/coloring.

### Examples
```python
set dot_solvent, 1
get_area polymer, load_b=1
```

### Related
[get_sasa_relative](#get_sasa_relative), `dot_solvent` setting

### Source
`packages/engine/modules/pymol/querying.py:1099`; parity: implemented.

---

## get_sasa_relative

Compute relative per-residue solvent-accessible surface area and optionally
label/color residues by exposure.

### Syntax
`get_sasa_relative(selection='all', state=1, vis=-1, var='b', quiet=1, outfile='', *, subsele='all')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | atoms to measure |
| `state` | int | `1` | object state |
| `vis` | 0/1 | `-1` | show labels & color by exposure (`-1` → `!quiet`) |
| `var` | str | `'b'` | property to load the value into |
| `quiet` | 0/1 | `1` | print results to log |
| `outfile` | str | `''` | write to file instead of log |
| `subsele` | str | `'all'` | sub-selection, e.g. `sidechain` |

### Behaviour
Value is relative to full exposure of the residue, computed by isolating each
residue with its two neighbors. Loads `0.0` (buried) to `1.0` (exposed) into
`var` (default b-factor), readable in `iterate`/`alter`/`label`. Lives in
`util`, not `querying`, and temporarily forces `dot_solvent=1`.

### Examples
```python
fetch 1ubq, async=0
get_sasa_relative polymer
get_sasa_relative polymer, subsele=sidechain
```

### Related
[get_area](#get_area)

### Source
`packages/engine/modules/pymol/util.py:1064`; parity: implemented.

---

## get_chains

List the chain identifiers present in a selection.

### Syntax
`get_chains(selection='(all)', state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to scan |
| `state` | int | `0` | CURRENTLY IGNORED |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns a list of chain-id strings (empty list if none). The `state` argument is
accepted but ignored by the current implementation.

### Related
[get_names](#get_names), [count_atoms](#count_atoms)

### Source
`packages/engine/modules/pymol/querying.py:1128`; parity: implemented.

---

## get_names

Return object and/or selection names.

### Syntax
`get_names(type='public_objects', enabled_only=0, selection='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | str | `'public_objects'` | which names to return (see below) |
| `enabled_only` | int | `0` | restrict to enabled objects |
| `selection` | str | `''` | restrict to objects covered by a selection |

### Behaviour
`type` accepts `objects`, `selections`, `all`, `public`, `public_objects`,
`public_selections`, `public_nongroup_objects`, `public_group_objects`,
`nongroup_objects`, `group_objects` (each maps to an internal mode int); an
unknown type raises `CmdException`. Underscore-prefixed internal objects are
hidden unless the `type` includes the non-public variants.

### Examples
```python
cmd.get_names("objects")
cmd.get_names("selections", enabled_only=1)
```

### Related
[get_object_list](#get_object_list), [get_type](#get_type), [get_names_of_type](#get_names_of_type-note)

### Source
`packages/engine/modules/pymol/querying.py:1155`; parity: implemented.

---

## get_object_list

Return the object names covered by a selection.

### Syntax
`get_object_list(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | selection to resolve to objects |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Marked "unsupported" upstream but widely used: returns the list of molecule
object names that contribute atoms to the selection. Basis for
`get_selection_state`.

### Related
[get_names](#get_names)

### Source
`packages/engine/modules/pymol/querying.py:131`; parity: unknown (not yet in `packages/engine-ts/src`).

---

## get_title

Retrieve the per-state title string of an object.

### Syntax
`get_title(object, state, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | object name |
| `state` | int | — | 1-based state |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns the title text shown when the given state is active (set via
`set_title`), or `None` if unset. `state` has no default and must be supplied.

### Related
`set_title`

### Source
`packages/engine/modules/pymol/querying.py:176`; parity: unknown (not yet in `packages/engine-ts/src`).

---

## get_symmetry

Get crystal cell and spacegroup parameters for a molecule or map.

### Syntax
`get_symmetry(selection='(all)', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | object or selection |
| `state` | int | `-1` | state (current by default) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns a 7-element list `[a, b, c, alpha, beta, gamma, spacegroup]`, or a falsy
value when no symmetry is defined. With `quiet=0` prints the cell and spacegroup.

### Examples
```python
cmd.get_symmetry("1ubq")
```

### Related
[get_extent](#get_extent), `set_symmetry`

### Source
`packages/engine/modules/pymol/querying.py:147`; parity: implemented.

---

## get_version

Return the running PyMOL version tuple.

### Syntax
`get_version(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | `<1` prints; `<0` also prints build date & git sha |

### Behaviour
Returns a length-six tuple: version text, floating-point version, integer
version, build date (unix timestamp), git SHA, and SVN revision (where
available). Does not require the object lock.

### Source
`packages/engine/modules/pymol/querying.py:603`; parity: implemented.

---

## get_phipsi

Return backbone phi/psi angles for a CA selection.

### Syntax
`get_phipsi(selection='(name CA)', state=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(name CA)'` | CA atoms to analyze |
| `state` | int | `-1` | state (current by default) |

### Behaviour
Returns a dict keyed by `(object, index)` mapping each residue to a
`(phi, psi)` tuple. The user-facing `phi_psi` wraps this with pretty printing.

### Related
[phi_psi](#phi_psi), [get_dihedral](#get_dihedral)

### Source
`packages/engine/modules/pymol/querying.py:880`; parity: implemented.

---

## phi_psi

Return (and optionally print) phi/psi angles for a protein selection.

### Syntax
`phi_psi(selection='(byres pk1)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(byres pk1)'` | residues to report |
| `quiet` | int | `1` | `0` prints `resn-resi: (phi, psi)` per residue |

### Behaviour
Thin wrapper over [get_phipsi](#get_phipsi); returns the same `(object,index) →
(phi, psi)` dict. Default selection uses the picked atom (`pk1`) expanded by
residue.

### Related
[get_phipsi](#get_phipsi)

### Source
`packages/engine/modules/pymol/querying.py:1401`; parity: implemented.

---

## get_dihedral

Return the dihedral angle between four atoms.

### Syntax
`get_dihedral(atom1='pk1', atom2='pk2', atom3='pk3', atom4='pk4', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1..atom4` | str | `pk1..pk4` | single-atom selections |
| `state` | int | `-1` | state (current by default) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns degrees. Positive dihedrals are right-handed looking down the
atom2→atom3 axis. Each argument must resolve to a single atom.

### Examples
```python
get_dihedral 4/n, 4/c, 4/ca, 4/cb
get_dihedral 4/n, 4/c, 4/ca, 4/cb, state=4
```

### Related
[get_angle](#get_angle), [get_distance](#get_distance)

### Source
`packages/engine/modules/pymol/querying.py:1023`; parity: implemented.

---

## get_angle

Return the angle between three atoms.

### Syntax
`get_angle(atom1='pk1', atom2='pk2', atom3='pk3', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1..atom3` | str | `pk1..pk3` | single-atom selections |
| `state` | int | `-1` | state (current by default) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns degrees, using coordinates from `state`.

### Examples
```python
get_angle 4/n, 4/c, 4/ca
```

### Related
[get_dihedral](#get_dihedral), [get_distance](#get_distance)

### Source
`packages/engine/modules/pymol/querying.py:990`; parity: implemented.

---

## get_distance

Return the distance between two atoms.

### Syntax
`get_distance(atom1='pk1', atom2='pk2', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1`, `atom2` | str | `pk1`, `pk2` | single-atom selections |
| `state` | int | `-1` | state (current by default) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Returns Angstroms from `state`. Unlike the `distance` command, this only
measures and creates no measurement object.

### Examples
```python
get_distance 4/n, 4/c
get_distance 4/n, 4/c, state=4
```

### Related
[get_angle](#get_angle), `distance`

### Source
`packages/engine/modules/pymol/querying.py:958`; parity: implemented.

---

## get_type

Return a string describing the type of a named object or selection.

### Syntax
`get_type(name, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | object or selection name |
| `quiet` | int | `1` | `0` prints the type |

### Behaviour
Returns one of: `object:molecule`, `object:map`, `object:mesh`, `object:slice`,
`object:surface`, `object:measurement`, `object:cgo`, `object:group`,
`object:volume`, or `selection`.

### Related
[get_names](#get_names)

### Source
`packages/engine/modules/pymol/querying.py:1206`; parity: implemented.

---

## get_color_index

Return the integer color index for a color name/spec.

### Syntax
`get_color_index(color)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | str | — | color name or index string |

### Behaviour
Resolves a color name to PyMOL's internal integer index (calls `get_color`
mode 3). Companion `get_color_index_from_string_or_list` also accepts a `[r,g,b]`
list/tuple by first packing it to a `0xRRGGBB` string.

### Related
[get_color_tuple](#get_color_tuple), [get_color_indices](#get_color_indices)

### Source
`packages/engine/modules/pymol/querying.py:858`; parity: implemented.

---

## get_color_tuple

Return the RGB tuple (0.0–1.0) for a color.

### Syntax
`get_color_tuple(name, mode=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | color name or index |
| `mode` | int | `0` | leave at 0 (see below) |

### Behaviour
Returns `(r, g, b)` in 0.0–1.0, or `None` (with an error) for an unknown color.
`mode` 1/2/3 are discouraged (the docstring redirects to `get_color_indices` /
`get_color_index`); `mode=4` may return a negative R for special colors.

### Related
[get_color_index](#get_color_index), colors reference

### Source
`packages/engine/modules/pymol/querying.py:825`; parity: implemented.

---

## get_color_indices

Return the list of `(name, index)` pairs for defined colors.

### Syntax
`get_color_indices(all=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `all` | 0/1 | `0` | `1` includes all colors (mode 2), else public colors (mode 1) |

### Behaviour
Returns a list of `(colorname, index)` tuples. Used to reverse-map a color index
back to a name (e.g. in `get_property` display).

### Related
[get_color_index](#get_color_index), [get_color_tuple](#get_color_tuple)

### Source
`packages/engine/modules/pymol/querying.py:843`; parity: implemented.

---

## get_object_color_index

Return the color index assigned to an object.

### Syntax
`get_object_color_index(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | object name |

### Behaviour
Returns the object-level color index (the object's own color, distinct from
per-atom colors).

### Related
[get_color_index](#get_color_index)

### Source
`packages/engine/modules/pymol/querying.py:819`; parity: unknown (not yet in `packages/engine-ts/src`).

---

## count_atoms

Return the number of atoms in a selection.

### Syntax
`count_atoms(selection='(all)', quiet=1, state=0, domain='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to count |
| `quiet` | int | `1` | `0` prints the count |
| `state` | int | `0` | state (0=all) |
| `domain` | str | `''` | optional selection domain passed to `select` |

### Behaviour
Implemented by creating a temporary `_count_tmp` selection and returning its
size, then deleting it. Raises on error.

### Examples
```python
count_atoms polymer and name CA
```

### Related
[count_states](#count_states), [get_names](#get_names)

### Source
`packages/engine/modules/pymol/querying.py:1419`; parity: implemented.

---

## count_states

Return the number of states in a selection.

### Syntax
`count_states(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | objects to inspect |
| `quiet` | int | `1` | `0` prints the count |

### Behaviour
Returns the maximum number of coordinate states across the covered objects.

### Related
[count_frames](#count_frames), [count_atoms](#count_atoms)

### Source
`packages/engine/modules/pymol/querying.py:703`; parity: implemented.

---

## count_frames

Return the number of movie frames defined.

### Syntax
`count_frames(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | `0` prints the count |

### Behaviour
Counts frames defined for the PyMOL movie (see also `get_movie_length`, which
excludes molecular states).

### Related
[count_states](#count_states)

### Source
`packages/engine/modules/pymol/querying.py:759`; parity: implemented.

---

## count_discrete

Count the number of discrete objects in a selection.

### Syntax
`count_discrete(selection, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | atoms to inspect |
| `quiet` | int | `1` | `0` prints the count |

### Behaviour
Returns how many objects in the selection were loaded/created as *discrete*
(non-shared coordinate) objects.

### Related
[count_states](#count_states)

### Source
`packages/engine/modules/pymol/querying.py:1443`; parity: implemented.

---

## identify

Return atom IDs for a selection.

### Syntax
`identify(selection='(all)', mode=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to identify |
| `mode` | int | `0` | `0`=IDs only; `1`=`(object, id)` tuples |
| `quiet` | int | `1` | `0` prints results |

### Behaviour
Returns the stable source ID codes (the `ID` atom property), which survive atom
insertion/deletion (unlike `index`). Mode 1 pairs each ID with its object name.

### Related
[index](#index), [id_atom](#id_atom)

### Source
`packages/engine/modules/pymol/querying.py:1276`; parity: implemented.

---

## index

Return `(object, index)` tuples for a selection.

### Syntax
`index(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms to index |
| `quiet` | int | `1` | `0` prints results |

### Behaviour
Returns 1-based per-object atom indices as `(object, index)` tuples. **Indices
are fragile** — they change as atoms are added or deleted; prefer `identify`/`ID`
for durable references.

### Related
[identify](#identify), [id_atom](#id_atom)

### Source
`packages/engine/modules/pymol/querying.py:1309`; parity: implemented.

---

## id_atom

Return the source ID of a single atom.

### Syntax
`id_atom(selection, mode=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | must resolve to exactly one atom |
| `mode` | int | `0` | `0`=id; `1`=`(object, id)` |
| `quiet` | int | `1` | `0` prints result |

### Behaviour
Wraps `identify`; raises `CmdException` if the selection matches zero or more
than one atom.

### Related
[identify](#identify), [index](#index)

### Source
`packages/engine/modules/pymol/querying.py:1242`; parity: implemented.

---

## get_property

Get one object-level custom property.

### Syntax
`get_property(propname, name, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `propname` | str | — | property name |
| `name` | str | — | single object name |
| `state` | int | `0` | object state (0=all, -1=current) |
| `quiet` | int | `1` | `0` prints the value |

### Behaviour
Returns the stored value (typed) or `None` if unset / on error. Color-typed
properties are shown as a color name when `quiet=0`.

### Examples
```python
get_property myfloatprop, ala
```

### Related
[set_property](#set_property), [get_property_list](#get_property_list)

### Source
`packages/engine/modules/pymol/properties.py:54`; parity: implemented.

---

## set_property

Set an object-level custom property.

### Syntax
`set_property(name, value, object='*', state=0, proptype=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | property name |
| `value` | str/int/float/bool | — | value to store |
| `object` | str | `'*'` | space-separated objects or `*` for all |
| `state` | int | `0` | object state (0=all, -1=current) |
| `proptype` | int | `-1` | `-1`=auto, `1`=bool, `2`=int, `3`=float, `5`=color, `6`=str |
| `quiet` | int | `1` | suppress log output |

### Behaviour
`proptype=-1` auto-detects int (digits only), float, or bool
(true/false/yes/no); everything else is stored as string. Color values accept a
name, index, or `[r,g,b]` list.

### Examples
```python
fragment ala
set_property myfloatprop, 1234, ala, proptype=3
get_property myfloatprop, ala
```

### Related
[get_property](#get_property), [set_atom_property](#set_atom_property)

### Source
`packages/engine/modules/pymol/properties.py:123`; parity: implemented.

---

## get_property_list

Get all properties of an object as a list.

### Syntax
`get_property_list(object, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | single object name |
| `state` | int | `0` | object state (0=all, -1=current) |
| `quiet` | int | `1` | `0` prints the list |

### Behaviour
Returns the object's `(name, value)` property list (internally calls
`get_property` with a `None` propname).

### Related
[get_property](#get_property), [set_property](#set_property)

### Source
`packages/engine/modules/pymol/properties.py:99`; parity: implemented.

---

## set_atom_property

Set an atom-level custom property.

### Syntax
`set_atom_property(name, value, selection='all', state=0, proptype=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | property name |
| `value` | str/int/float/bool | — | value to store |
| `selection` | str | `'all'` | atoms to set on |
| `state` | int | `0` | object state (0=all, -1=current) |
| `proptype` | int | `-1` | `-1`=auto, `1`=bool, `2`=int, `3`=float, `5`=color, `6`=str |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Atom properties are then reachable in `iterate`/`alter` via the `p` object
(`p.myprop`). Assigning `p.myprop = None` in `alter` clears it. Type coercion
matches `set_property`.

### Examples
```python
set_atom_property myfloatprop, 1.23, elem C
iterate elem C, print(p.myfloatprop)
alter all, p.myfloatprop = None   # clear
```

### Related
[set_property](#set_property), [iterate](#iterate), [alter](#alter)

### Source
`packages/engine/modules/pymol/properties.py:171`; parity: implemented.

---

## get_object_matrix

Return the transformation matrices associated with an object.

### Syntax
`get_object_matrix(object, state=1, incl_ttt=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | object name |
| `state` | int | `1` | state |
| `incl_ttt` | int | `1` | include the TTT (camera) matrix |

### Behaviour
Marked "unsupported" upstream. Returns the object's 4×4 transform as a flat
16-element tuple, optionally folding in the TTT matrix.

### Related
[get_object_settings](#get_object_settings), `set_object_ttt`

### Source
`packages/engine/modules/pymol/querying.py:89`; parity: implemented.

---

## get_object_settings

Return the object-/state-level settings blob for an object.

### Syntax
`get_object_settings(object, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | object name |
| `state` | int | `0` | state (Python passes `state-1`; `ALL_STATES` default) |
| `quiet` | int | `1` | suppress log output |

### Behaviour
Marked "unsupported" upstream. Returns the internal settings container for the
object at the given state, or `None` when nothing is overridden.

### Related
[get_object_matrix](#get_object_matrix), settings reference

### Source
`packages/engine/modules/pymol/querying.py:121`; parity: unknown (not yet in `packages/engine-ts/src`).

---

## Related domains

- Selection language for the atom expressions used everywhere here:
  [selection-algebra](../topics/selection-algebra.md)
- Geometry-object commands (`distance`, `angle`, `dihedral`) that *create*
  measurement objects rather than just returning numbers live in the
  measurement domain.
