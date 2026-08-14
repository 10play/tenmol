---
name: editing-building
kind: feature
category: editing-building
subcategory: overview
summary: Molecular editing and the Builder — the pk1-pk4 editor selections and the commands that pick, bond, build, remove, add hydrogens, edit coordinates, fix chemistry, and mutate structures, plus the Builder dock panel that drives them.
parity: implemented
---

## Purpose

This is the "modify the molecule" surface of PyMOL. Everything here mutates atoms and bonds
in place rather than just displaying them: you pick atoms into the reserved `pk1`-`pk4`
selections, then create/delete bonds, attach fragments and residues, add or fix hydrogens,
edit coordinates (torsion, dihedral, drag, alter_state), and repair chemistry. The
[Builder panel](#the-builder-panel) is a GUI over these same `cmd.*` calls — every button issues
one. Most routines operate on the current editor picks by default, so `edit` (or a viewport click)
almost always comes first.

The command signatures and defaults below are copied verbatim from `docs/api-reference/commands.mdx`;
prose is enriched from the upstream `editing.py` / `editor.py` docstrings and `docs/builder.md`.

## The pk1-pk4 editor selections

The editor is a small state machine (`packages/engine/layer3/Editor.cpp/.h`) built around four
reserved, click-ordered atom selections. They are the implicit default arguments of nearly every
editing command.

| name | meaning | source |
|---|---|---|
| `pk1` `pk2` `pk3` `pk4` | the picked atoms, in click order | `Editor.h:30` |
| `pkset` | union of all picked atoms | `Selector.cpp:4202` |
| `pkbond` | the two atoms of a picked bond | `Selector.cpp:4323` |
| `pkresi` / `pkchain` / `pkobject` | `byres` / `bychain` / `byobject` of a single pick | `Editor.h` |
| `pkmol` | the whole connected component being edited | `Editor.h` |
| `pkfrag`, `_pkfrag1..N`, `_pkbase*` | the movable fragments computed by `SelectorSubdivide` | `Editor.h` |

**Behaviour.** A viewport click in atom-pick mode (`SceneMouse.cpp:cButModePickAtom`) fills the
first free slot in order `pk1 -> pk2 -> pk3 -> pk4`; once all four are taken, further picks
**overwrite `pk4`**. Clicking an already-picked atom unpicks it. Bond picking fills `pk1`+`pk2`
with `pkbond` set. When `editor_auto_measure`/`editor_auto_dihedral` are on, activating picks
auto-creates an `_auto_measure` distance/angle/dihedral object. Programmatically, [edit](#edit)
creates the picks and [unpick](#unpick) clears them.

**Source.** `packages/engine/layer3/Editor.cpp:498` (`EditorGetNextMultiatom`), `docs/builder.md` §7.
Parity: `packages/engine-ts/src/cmd/editing.ts` models `pk1`/`pk2` via `edit`.

## edit

### Purpose
Pick atoms or a bond for editing by defining the `pk1`-`pk4` selections without a mouse click.

### Syntax
`edit(selection1='', selection2='none', selection3='none', selection4='none', pkresi=0, pkbond=1, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection1` | str | `''` | atom to pick as `pk1` |
| `selection2` | str | `'none'` | second atom; with `pkbond`, picks the bond between `pk1` and `pk2` |
| `selection3` | str | `'none'` | third atom (`pk3`) |
| `selection4` | str | `'none'` | fourth atom (`pk4`) |
| `pkresi` | int | `0` | also expand to `pkresi` |
| `pkbond` | int | `1` | if set and two selections given, pick the connecting bond |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
One selection picks an atom; two (with `pkbond=1`) pick the bond between them. Each selection must
resolve to a single atom, and multi-atom picks must belong to the same molecule, or `EditorSelect`
raises *"Invalid input selection(s)"* / *"Both pk selections must belong to the same molecule."*

### Examples
```
edit chain A and resi 45 and name CA
edit (name C), (name N)      # pick the C-N bond
```

### Related
[unpick](#unpick), [remove_picked](#remove_picked), [cycle_valence](#cycle_valence), [torsion](#torsion)

### Source
`packages/engine/modules/pymol/editing.py:1080`; `docs/builder.md` §7e. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts:261`).

## unpick

### Purpose
Delete the special `pk1`, `pk2`, ... editor selections used for atom picking and editing.

### Syntax
`unpick()`

### Behaviour
Clears all `pkN` selections and deactivates the editor picks. Called at the end of most Builder
actions to reset state. Takes no arguments.

### Examples
```
unpick
```

### Related
[edit](#edit)

### Source
`packages/engine/modules/pymol/editing.py:991`. Parity: partial — registered as a no-op stub in the
TS port (`packages/engine-ts/src/cmd/extras.ts:524`; no live picking model).

## protect

### Purpose
Protect a set of atoms from transformations performed by the editing features (torsion, drag,
sculpt), useful when modifying an internal portion of a chain without moving the rest.

### Syntax
`protect(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'(all)'` | atoms to protect (sets the `protected` flag) |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Sets the internal protect flag; protected atoms are held immobile during editing moves. Reversed by
[deprotect](#deprotect). Distinct from [mask](#mask), which only blocks mouse selection.

### Examples
```
protect not (byres (pk1 around 5))
```

### Related
[deprotect](#deprotect), [mask](#mask), [unmask](#unmask)

### Source
`packages/engine/modules/pymol/editing.py:2763`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts`).

## deprotect

### Purpose
Reverse the effect of [protect](#protect) on the indicated atoms.

### Syntax
`deprotect(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'(all)'` | atoms to clear the protect flag on |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Clears the protect flag so the atoms move again under editing transformations.

### Examples
```
deprotect
```

### Related
[protect](#protect), [mask](#mask), [unmask](#unmask)

### Source
`packages/engine/modules/pymol/editing.py:2796`. Parity: implemented.

## mask

### Purpose
Make atoms impossible to select with the mouse — useful when a foreground molecule sits in front of
a background one you keep clicking by accident.

### Syntax
`mask(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'(all)'` | atoms to mask from mouse picking |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Only affects mouse pickability, not command-line selectability or transformations (that is
[protect](#protect)). Reversed by [unmask](#unmask).

### Examples
```
mask polymer
```

### Related
[unmask](#unmask), [protect](#protect), [deprotect](#deprotect)

### Source
`packages/engine/modules/pymol/controlling.py:870`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts`).

## unmask

### Purpose
Reverse the effect of [mask](#mask) so the atoms can be picked with the mouse again.

### Syntax
`unmask(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'(all)'` | atoms to unmask |
| `quiet` | int | `1` | suppress feedback |

### Examples
```
unmask all
```

### Related
[mask](#mask), [protect](#protect), [deprotect](#deprotect)

### Source
`packages/engine/modules/pymol/controlling.py:897`. Parity: implemented.

## bond

### Purpose
Create a new bond between two single-atom selections (defaulting to the editor picks `pk1`/`pk2`).

### Syntax
`bond(atom1='pk1', atom2='pk2', order=1, quiet=1, symop='')`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `atom1` | str | `'pk1'` | first atom selection (one atom) |
| `atom2` | str | `'pk2'` | second atom selection (one atom) |
| `order` | int | `1` | bond order |
| `quiet` | int | `1` | suppress feedback |
| `symop` | str | `''` | symmetry operation code for the second atom (e.g. `1_555`) |

### Behaviour
Both selections must contain exactly one atom, and both must be in the same object (bonds are
intra-object). Existing bonds are not duplicated; returns the number of bonds added. The Builder's
`Create` button follows a `bond` with `h_fill` to repair hydrogens.

### Examples
```
bond (name SG and resi 5), (name SG and resi 40)
```

### Related
[unbond](#unbond), [add_bond](#add_bond), [fuse](#fuse), [attach](#attach), [valence](#valence)

### Source
`packages/engine/modules/pymol/editing.py:696`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts:156`).

## unbond

### Purpose
Remove all bonds between two selections.

### Syntax
`unbond(atom1='(pk1)', atom2='(pk2)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `atom1` | str | `'(pk1)'` | first selection |
| `atom2` | str | `'(pk2)'` | second selection |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Deletes every bond spanning the two selections. Unlike [bond](#bond) the selections may contain many
atoms. The Builder's `Delete` bond button pairs it with `h_fill`.

### Examples
```
unbond pk1, pk2
```

### Related
[bond](#bond), [fuse](#fuse), [remove_picked](#remove_picked)

### Source
`packages/engine/modules/pymol/editing.py:763`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts`).

## add_bond

### Purpose
API-only helper to add a bond by 1-based atom indices (as reported by `cmd.iterate`), when you do not
have picks or selections handy.

### Syntax
`add_bond(oname, index1, index2, order=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `oname` | str | — | object name |
| `index1` | int | — | first atom index (1-based) |
| `index2` | int | — | second atom index (1-based) |
| `order` | int | `1` | bond order |

### Behaviour
To add bonds by selection instead, use [bond](#bond).

### Examples
```python
cmd.add_bond("mol", 3, 7, 2)
```

### Related
[bond](#bond), `get_bonds`

### Source
`packages/engine/modules/pymol/editing.py:652`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts`).

## cycle_valence

### Purpose
Cycle the valence (single -> double -> triple -> ...) of the currently picked bond.

### Syntax
`cycle_valence(h_fill=1, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `h_fill` | int | `1` | remove/refill hydrogens after the change |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Operates on the picked bond (`pkbond`/`pk1`+`pk2`). Whether aromatic is included in the cycle is
governed by `editor_bond_cycle_mode` (`>0` includes aromatic). With `h_fill=1` open valences are
re-hydrogenated. The Builder `Cycle` button and the `ValenceWizard` in cycle mode call it.

### Examples
```
edit (id 4), (id 5)
cycle_valence
```

### Related
[valence](#valence), [h_fill](#h_fill), [replace](#replace), [remove_picked](#remove_picked)

### Source
`packages/engine/modules/pymol/editing.py:876`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts`).

## valence

### Purpose
Set the bond order of all bonds formed between two atom selections (single/double/triple/aromatic).

### Syntax
`valence(order, selection1=None, selection2=None, source='', target_state=0, source_state=0, reset=1, quiet=1, symop='')`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `order` | — | — | `'0'`-`'4'`, `'aromatic'`=4, `'guess'`=-1, `'copy'`=-2 |
| `selection1` | — | `None` | first selection (defaults to `pk1`) |
| `selection2` | — | `None` | second selection (defaults to `pk2`) |
| `source` | — | `''` | source object for `copy` mode |
| `target_state` | — | `0` | target state |
| `source_state` | — | `0` | source state |
| `reset` | — | `1` | reset geometry after change |
| `quiet` | — | `1` | suppress feedback |
| `symop` | — | `''` | symmetry operation code |

### Behaviour
`order` is mapped through `order_dict` (`editing.py:598`). Unlike [cycle_valence](#cycle_valence) it
sets an explicit order rather than stepping. The `ValenceWizard` and the Builder's `|`/`||`/`|||`/`Arom`
buttons wrap it and call `h_fill` when `order >= 0`.

### Examples
```
valence 2, pk1, pk2
valence aromatic, (resi 10)
```

### Related
[cycle_valence](#cycle_valence), [bond](#bond), [h_fill](#h_fill)

### Source
`packages/engine/modules/pymol/editing.py:598`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts`).

## rebond

### Purpose
Discard all bonds in an object and recompute them by interatomic distance.

### Syntax
`rebond(oname, state=-1, pbc=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `oname` | str | — | object name |
| `state` | int | `-1` | object state (-1 = current) |
| `pbc` | int | `1` | use periodic boundary conditions (only if symmetry is defined) |

### Behaviour
Useful after loading coordinates with wrong or missing connectivity. Distance-based bonding uses
covalent-radius sums; PBC lets bonds wrap across the unit cell.

### Examples
```
rebond mymol
```

### Related
[bond](#bond), [unbond](#unbond), [sort](#alter)

### Source
`packages/engine/modules/pymol/editing.py:678`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts`).

## attach

### Purpose
Add a single atom onto the picked atom, growing the molecule by one atom.

### Syntax
`attach(element, geometry, valence, name='', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `element` | str | — | element symbol of the new atom |
| `geometry` | int | — | geometry code: 1=Single, 2=Linear, 3=Planar, 4=Tetrahedral, 5=None |
| `valence` | int | — | valence of the new atom |
| `name` | str | `''` | optional atom name |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Attaches to `pk1`. The `geometry` code (from `AtomInfo.h:129`) sets how the new atom's own valence
is arranged for later hydrogen filling. Used internally by nucleic-acid building (`add2pO`).

### Examples
```
edit (name O2' and resi 4)
attach O, 4, 4
```

### Related
[replace](#replace), [fuse](#fuse), [set_geometry](#set_geometry)

### Source
`packages/engine/modules/pymol/editing.py:921`. Parity: implemented
(`packages/engine-ts/src/cmd/builder.ts:515`).

## replace

### Purpose
Replace the picked atom with a new atom of a different element/geometry.

### Syntax
`replace(element, geometry, valence, h_fill=1, name='', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `element` | str | — | new element symbol |
| `geometry` | int | — | geometry code 1-5 (see [attach](#attach)) |
| `valence` | int | — | new valence |
| `h_fill` | int | `1` | refill hydrogens after replacement |
| `name` | str | `''` | optional atom name |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
The Builder's element row (`H C N O P S F Cl Br I`) calls this with fixed geometry/valence per
element (e.g. `replace("C",4,4)` tetrahedral carbon). With `h_fill=1` the surrounding hydrogens are
regenerated.

### Examples
```
edit (id 12)
replace N, 4, 3       # tetrahedral nitrogen
```

### Related
[attach](#attach), [remove](#remove), [fuse](#fuse), [bond](#bond)

### Source
`packages/engine/modules/pymol/editing.py:1572`. Parity: implemented
(`packages/engine-ts/src/cmd/builder.ts:673`).

## fuse

### Purpose
Join two objects into one by forming a bond between one atom of each; a copy of the first object is
moved into a reasonable bonding geometry, then merged with the second.

### Syntax
`fuse(selection1='(pk1)', selection2='(pk2)', mode=0, recolor=1, move=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection1` | str | `'(pk1)'` | single atom (copied into object 2) |
| `selection2` | str | `'(pk2)'` | single atom in the target object |
| `mode` | int | `0` | fuse mode (0 = default; higher modes skip the copy/move step) |
| `recolor` | bool | `1` | recolor carbon atoms to match the target |
| `move` | bool | `1` | move the copy into bonding position |

### Behaviour
The atom in `selection1` is consumed to form the bond. This is the mechanism behind fragment/residue
attachment (`editor.attach_fragment`/`attach_amino_acid` use `fuse(..., 1)` and `fuse(..., 2)`).
There is no separate `join` command — fusing objects is how PyMOL joins molecules.

### Examples
```
fuse (methane and id 1), (mol and name C5)
```

### Related
[bond](#bond), [attach](#attach), [replace](#replace), [fragment](#fragment), [join](#join)

### Source
`packages/engine/modules/pymol/editing.py:939`. Parity: implemented
(`packages/engine-ts/src/cmd/builder.ts:761`).

## fab

### Purpose
Build a peptide from a one-letter sequence string, optionally in a chosen secondary structure.

### Syntax
`fab(input, name=None, mode='peptide', resi=1, chain='', segi='', state=-1, dir=1, hydro=-1, ss=0, async_=0, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `input` | str | — | sequence in one-letter code |
| `name` | str | `None` | object name to create |
| `mode` | str | `'peptide'` | build mode |
| `resi` | int | `1` | starting residue number |
| `chain` | str | `''` | chain id |
| `segi` | str | `''` | segment id |
| `state` | int | `-1` | target state |
| `dir` | int | `1` | build direction |
| `hydro` | int | `-1` | keep hydrogens (-1 follows `auto_remove_hydrogens`) |
| `ss` | int | `0` | secondary structure: 1=alpha helix, 2=antiparallel beta, 3=parallel beta, 4=flat |
| `async_` | int | `0` | build in background |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
One-letter codes resolve through `_aa_codes` (`editor.py:294`). `ss` maps to backbone phi/psi
dihedrals. This is the non-GUI complement to the Builder's Protein tab.

### Examples
```
fab ACDEFGH, mypep, ss=1
```

### Related
[fnab](#fnab), [fragment](#fragment), [The Builder panel](#the-builder-panel)

### Source
`packages/engine/modules/pymol/editor.py:1062`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts:569`).

## fnab

### Purpose
Build a nucleic acid from a one-letter sequence, using 3DNA fiber-model fragments.

### Syntax
`fnab(input, name=None, mode='DNA', form='B', dbl_helix=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `input` | str | — | sequence as one-letter codes |
| `name` | str | `None` | object name (default `obj`) |
| `mode` | str | `'DNA'` | `"DNA"` or `"RNA"` |
| `form` | str | `'B'` | helix form `"A"` or `"B"` |
| `dbl_helix` | int | `1` | build a complementary double helix |

### Behaviour
The non-GUI complement to the Nucleic Acid tab. RNA is forced to form A / single strand internally.
Fragments are the 3DNA fiber models (Lu & Olson, 2003).

### Examples
```
fnab ATGCGATAC, name=myDNA, mode=DNA, form=B, dbl_helix=1
```

### Related
[fab](#fab), [The Builder panel](#the-builder-panel)

### Source
`packages/engine/modules/pymol/editor.py:1100`. Parity: implemented
(`packages/engine-ts/src/cmd/nucleic.ts:165`).

## fragment

### Purpose
Retrieve a 3D structure from the built-in fragment library (amino acids and a set of chemical
fragments) as a new object.

### Syntax
`fragment(name, object=None, origin=1, zoom=0, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `name` | str | — | fragment name (e.g. `ala`, `benzene`, `methane`) |
| `object` | str | `None` | object to create/append into |
| `origin` | int | `1` | recenter the fragment at the origin |
| `zoom` | int | `0` | zoom to the new fragment |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
The library lives on disk as pickled chempy fragments (`data/chempy/fragments/*.pkl`, 131 files).
`fragment` is the load primitive behind every Builder attach path (`editor.attach_fragment` calls
`fragment` then [fuse](#fuse)). Creating a fragment with the name of an existing object errors.

### Examples
```
fragment ala
fragment benzene, ring1
```

### Related
[fab](#fab), [fnab](#fnab), [fuse](#fuse), [pseudoatom](#pseudoatom)

### Source
`packages/engine/modules/pymol/creating.py:943`; `docs/builder.md` §3. Parity: implemented — the TS
port ships a subset of the library (`packages/engine-ts/src/model/fragments.ts`,
`aa-fragments.json`).

## pseudoatom

### Purpose
Add a pseudoatom (a placeholder/marker atom, e.g. for labels, distances, or a center-of-mass point)
to a molecular object, creating the object if needed.

### Syntax
`pseudoatom(object='', selection='', name='PS1', resn='PSD', resi='1', chain='P', segi='PSDO', elem='PS', vdw=-1.0, hetatm=1, b=0.0, q=0.0, color='', label='', pos=None, state=0, mode='rms', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `object` | str | `''` | target object (created if absent) |
| `selection` | str | `''` | atoms whose position defines `pos` |
| `name` | str | `'PS1'` | atom name |
| `resn` | str | `'PSD'` | residue name |
| `resi` | str | `'1'` | residue id |
| `chain` | str | `'P'` | chain id |
| `segi` | str | `'PSDO'` | segment id |
| `elem` | str | `'PS'` | element |
| `vdw` | float | `-1.0` | VDW radius |
| `hetatm` | int | `1` | flag as HETATM |
| `b` / `q` | float | `0.0` | B-factor / occupancy |
| `color` | str | `''` | color |
| `label` | str | `''` | label text |
| `pos` | — | `None` | explicit `[x,y,z]` position |
| `state` | int | `0` | state |
| `mode` | str | `'rms'` | how to derive `pos` from `selection` (`rms`, `center`, ...) |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
If `pos` is omitted, the position is computed from `selection` per `mode` (e.g. center of mass).
A common use is a labelled marker or a fixed point for measurement/pseudo-bonds.

### Examples
```
pseudoatom com, selection=polymer, mode=center, label=COM
pseudoatom marker, pos=[0,0,0], color=yellow
```

### Related
[fragment](#fragment), [alter](#alter)

### Source
`packages/engine/modules/pymol/creating.py:1091`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts:490`).

## join

### Purpose
There is no `join` command in PyMOL. Joining two molecular objects into one is done with
[fuse](#fuse) (forms a bond and merges) or `create`/`combine` for a bondless merge.

### Behaviour
Referenced here only for discoverability: reach for [fuse](#fuse) to bond-and-merge, or
`cmd.create("merged", "objA or objB")` to combine without bonding.

### Related
[fuse](#fuse), [fragment](#fragment)

### Source
No such command in `docs/api-reference/commands.mdx`. Parity: unknown (not a command).

## remove

### Purpose
Eliminate the atoms in a selection from their molecular objects.

### Syntax
`remove(selection, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | — | atoms to delete |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Removes atoms (and their bonds) but keeps the object; contrast [delete](#delete) which removes whole
objects/selections. `auto_remove_hydrogens` uses `remove("hydro ...")` internally after edits.

### Examples
```
remove hydro
remove resn HOH
```

### Related
[remove_picked](#remove_picked), [delete](#delete)

### Source
`packages/engine/modules/pymol/editing.py:802`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts`).

## remove_picked

### Purpose
Remove the atom or bond currently picked for editing.

### Syntax
`remove_picked(hydrogens=1, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `hydrogens` | int | `1` | also remove/refill attached hydrogens |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Acts on `pk1`/`pkset` (or the picked bond). The Builder's atom `Delete` button expands the pick by
`extend 1`, calls `remove_picked`, then `fix_chemistry`+`h_add` to repair the site.

### Examples
```
edit (id 10)
remove_picked
```

### Related
[remove](#remove), [attach](#attach), [replace](#replace)

### Source
`packages/engine/modules/pymol/editing.py:839`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts:402`).

## delete

### Purpose
Remove whole objects and named selections (not individual atoms).

### Syntax
`delete(name)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `name` | str | — | object/selection name or pattern to delete |

### Behaviour
Deletes named objects and selections; to delete atoms within an object use [remove](#remove). The
Builder's `Clear` button runs `delete("all")` behind a confirm dialog.

### Examples
```
delete pk1
delete all
```

### Related
[remove](#remove), `delete_states`

### Source
`packages/engine/modules/pymol/editing.py`. Parity: implemented (executive-level in the TS port).

## h_add

### Purpose
Add hydrogens onto a molecule based on the current valences of the heavy atoms.

### Syntax
`h_add(selection='(all)', quiet=1, state=0, legacy=0)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'(all)'` | atoms to hydrogenate |
| `quiet` | int | `1` | suppress feedback |
| `state` | int | `0` | state (0 = all) |
| `legacy` | int | `0` | use the legacy H-placement algorithm |

### Behaviour
Fills *all* open valences with hydrogens (contrast [protonate](#protonate), which is pH-aware). The
Builder's `Add H` button calls `h_add("pkmol")`.

### Examples
```
h_add polymer
```

### Related
[h_fill](#h_fill), [h_fix](#h_fix), [protonate](#protonate)

### Source
`packages/engine/modules/pymol/editing.py:1218`. Parity: implemented
(`packages/engine-ts/src/cmd/builder.ts:559`).

## h_fill

### Purpose
Remove and replace the hydrogens on the atom or bond currently picked for editing.

### Syntax
`h_fill(quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Operates on the picks; used after bond-order changes and charge edits to regenerate the correct
number of hydrogens around the modified site. The Builder's `Fix H` button calls it.

### Examples
```
edit (id 5)
h_fill
```

### Related
[h_add](#h_add), [cycle_valence](#cycle_valence), [edit](#edit)

### Source
`packages/engine/modules/pymol/editing.py:1165`. Parity: implemented
(`packages/engine-ts/src/cmd/builder.ts:580`).

## h_fix

### Purpose
Reposition hydrogen atoms (an unsupported/legacy command that repositions existing H atoms rather
than adding new ones).

### Syntax
`h_fix(selection='', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `''` | atoms whose hydrogens to reposition |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Marked unsupported upstream; used inside `attach_amino_acid`/`attach_nuc_acid` to fix backbone/amide
hydrogen geometry after fusing residues.

### Examples
```
h_fix pk1
```

### Related
[h_add](#h_add), [h_fill](#h_fill)

### Source
`packages/engine/modules/pymol/editing.py:1197`. Parity: partial — no-op stub in the TS port
(`packages/engine-ts/src/cmd/extras.ts:526`).

## protonate

### Purpose
Add hydrogens with pH-dependent protonation states, unlike [h_add](#h_add) which fills every open
valence regardless of pKa.

### Syntax
`protonate(selection='all', pH=7.4, ff='amber', state=0, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'all'` | atoms to protonate |
| `pH` | float | `7.4` | target pH |
| `ff` | str | `'amber'` | pdb2pqr force field (amber, charmm, parse, ...) |
| `state` | int | `0` | state |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
When pdb2pqr is available it uses PROPKA for per-residue pKa prediction; otherwise it falls back to
textbook pKa values for standard titratable residues. Heavy-atom visual settings are preserved.

### Examples
```
protonate polymer, pH=5.5
```

### Related
[h_add](#h_add), [h_fill](#h_fill)

### Source
`packages/engine/modules/pymol/editing.py:1444`. Parity: implemented
(`packages/engine-ts/src/cmd/builder.ts:616`).

## alter

### Purpose
Change atomic properties (name, resn, chain, formal_charge, b, q, vdw, color, ...) by evaluating a
Python expression once per atom in a temporary namespace.

### Syntax
`alter(selection, expression, quiet=1, space=None)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | — | atoms to modify |
| `expression` | str | — | Python statement evaluated per atom (atom fields are local variables) |
| `quiet` | int | `1` | suppress feedback |
| `space` | dict | `None` | extra namespace passed to the expression |

### Behaviour
Edits identifiers/properties, not coordinates (use [alter_state](#alter_state) for coordinates). After
changing identifiers that affect ordering (chain, resi, name) call `sort` to re-order atoms. The
Builder's charge buttons run `alter(sele, "formal_charge=N")` then [h_fill](#h_fill).

### Examples
```
alter chain A, chain='B'
alter pk1, formal_charge=-1
alter name CA, vdw=2.0
```

### Related
[alter_state](#alter_state), `iterate`, [rebond](#rebond)

### Source
`packages/engine/modules/pymol/editing.py:1708`. Parity: implemented
(`packages/engine-ts/src/cmd/analysis.ts:311`).

## alter_state

### Purpose
Change atomic coordinates (and coordinate-level flags) over a given state and selection using a
per-atom Python expression.

### Syntax
`alter_state(state, selection, expression, quiet=1, space=None, atomic=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `state` | int | — | state to modify (0 = all) |
| `selection` | str | — | atoms to modify |
| `expression` | str | — | per-coordinate Python statement (`x,y,z` are locals) |
| `quiet` | int | `1` | suppress feedback |
| `space` | dict | `None` | extra namespace |
| `atomic` | int | `1` | expose atomic properties (read-only) in the namespace |

### Behaviour
The coordinate counterpart of [alter](#alter). The Builder's `Scramble Coords` sculpt action uses it
with a random-displacement helper passed via `space`.

### Examples
```
alter_state 1, all, (x,y,z) = (x+10, y, z)
alter_state 1, sele, x = rand(), space={'rand': random.random}
```

### Related
[alter](#alter), [translate_atom](#translate_atom), `iterate_state`

### Source
`packages/engine/modules/pymol/editing.py:1821`. Parity: implemented
(`packages/engine-ts/src/cmd/analysis.ts`).

## translate_atom

### Purpose
Translate a single picked atom by a vector, used by the editor's coordinate-drag mechanics.

### Syntax
`translate_atom(sele1, v0, v1, v2, state=0, mode=0, log=0)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `sele1` | str | — | single-atom selection to move |
| `v0` `v1` `v2` | float | — | translation vector components |
| `state` | int | `0` | state |
| `mode` | int | `0` | translation mode |
| `log` | int | `0` | write action to the log file |

### Behaviour
Moves one atom's coordinates; the low-level primitive behind interactive atom dragging.

### Examples
```python
cmd.translate_atom("pk1", 0.0, 0.5, 0.0)
```

### Related
[drag](#drag), [alter_state](#alter_state), `translate`

### Source
`packages/engine/modules/pymol/editing.py:2507`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts`).

## drag

### Purpose
Activate interactive dragging of a selection, letting the user manipulate atom coordinates with
mouse controls like those used for the camera.

### Syntax
`drag(selection=None, wizard=1, edit=1, quiet=1, mode=-1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `None` | atoms to drag (if omitted, uses current picks) |
| `wizard` | int | `1` | activate the drag wizard |
| `edit` | int | `1` | keep edit mode active |
| `quiet` | int | `1` | suppress feedback |
| `mode` | int | `-1` | drag mode |

### Behaviour
Turns the current selection into a draggable body. Interactive rather than deterministic, so the TS
port models the mouse-side input but registers the `cmd.drag` command itself as a no-op.

### Examples
```
drag byres pk1
```

### Related
[translate_atom](#translate_atom), [edit](#edit), [The Builder panel](#the-builder-panel)

### Source
`packages/engine/modules/pymol/editing.py:1020`. Parity: partial — no-op stub
(`packages/engine-ts/src/cmd/extras.ts:522`; drag input handled at `backend.ts:146`).

## torsion

### Purpose
Rotate the torsion about the currently picked bond by a given angle.

### Syntax
`torsion(angle)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `angle` | float | — | rotation angle in degrees |

### Behaviour
The rotated fragment corresponds to the first atom of the picked bond (or the nearest atom when
picked with the mouse). Requires a picked bond (`pk1`+`pk2` with `pkbond`).

### Examples
```
edit (id 4), (id 5)
torsion 30
```

### Related
[set_dihedral](#set_dihedral), [edit](#edit), [remove_picked](#remove_picked)

### Source
`packages/engine/modules/pymol/editing.py:1135`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts:314`).

## set_dihedral

### Purpose
Set the dihedral angle formed by four bonded atoms to an absolute value (atoms must be acyclic).

### Syntax
`set_dihedral(atom1, atom2, atom3, atom4, angle, state=1, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `atom1`..`atom4` | str | — | four single-atom selections defining the dihedral |
| `angle` | float | — | target dihedral angle (degrees) |
| `state` | int | `1` | state to modify |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Unlike [torsion](#torsion) (which rotates by a delta about a picked bond), this sets an absolute
angle from four named atoms. Backbone phi/psi/omega placement in residue building uses it.

### Examples
```
set_dihedral (id 1),(id 2),(id 3),(id 4), 180
```

### Related
[torsion](#torsion), `get_dihedral`, [set_geometry](#set_geometry)

### Source
`packages/engine/modules/pymol/editing.py:2564`. Parity: implemented
(`packages/engine-ts/src/cmd/editing.ts:540`).

## set_geometry

### Purpose
Change PyMOL's assumptions about the proper valence and geometry (hybridization) of atoms in a
selection, so later hydrogen filling and bonding behave correctly.

### Syntax
`set_geometry(selection, geometry, valence)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | — | atoms to reconfigure |
| `geometry` | int | — | geometry code: 1=Single, 2=Linear, 3=Planar, 4=Tetrahedral, 5=None |
| `valence` | int | — | target valence |

### Behaviour
Does not move atoms; it changes the stored geometry so `h_fill`/`h_add` place hydrogens correctly.
Residue building calls `set_geometry(N, 3, 3)` to make the connecting nitrogen planar before fusing.

### Examples
```
set_geometry (name N and resi 5), 3, 3
```

### Related
[attach](#attach), [replace](#replace), [h_fill](#h_fill), [bond](#bond)

### Source
`packages/engine/modules/pymol/editing.py:473`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts`).

## assign_stereo

### Purpose
Assign the `stereo` atom property (R/S stereochemistry).

### Syntax
`assign_stereo(selection='all', state=-1, method='', quiet=1, prop='stereo')`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | `'all'` | atoms to assign |
| `state` | int | `-1` | state (-1 = current) |
| `method` | str | `''` | backend to use (Schrodinger or RDKit; auto if empty) |
| `quiet` | int | `1` | suppress feedback |
| `prop` | str | `'stereo'` | atom property to store the result in |

### Behaviour
Requires either a Schrodinger Suite installation (`SCHRODINGER` env var) or RDKit (the `rdkit` Python
module). Without one it does nothing.

### Examples
```
assign_stereo mymol
```

### Related
[invert](#invert), [alter](#alter)

### Source
`packages/engine/modules/pymol/stereochemistry/__init__.py:7`. Parity: partial — no-op stub, chemistry
not modeled (`packages/engine-ts/src/cmd/extras.ts:555`).

## fix_chemistry

### Purpose
Repair chemistry (bond orders, valences, missing/extra atoms) around a modified site — an unsupported
best-effort feature.

### Syntax
`fix_chemistry(selection1='all', selection2='all', invalidate=1, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection1` | str | `'all'` | atoms to fix |
| `selection2` | str | `'all'` | second selection scoping the repair |
| `invalidate` | int | `1` | invalidate/rebuild representations afterward |
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Marked "unsupported" upstream but used by the Builder after atom deletion to re-derive sane
connectivity, followed by [h_add](#h_add).

### Examples
```
fix_chemistry _builder_active
```

### Related
[clean](#clean), [rebond](#rebond), [h_add](#h_add)

### Source
`packages/engine/modules/pymol/editing.py:2851`. Parity: implemented
(`packages/engine-ts/src/cmd/editor.ts`).

## clean

### Purpose
Energy-minimize a selection with an MMFF94 force field to clean up strained geometry after building.

### Syntax
`clean(selection, present='', state=-1, fix='', restrain='', method='mmff', async_=0, save_undo=1, message=None)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | str | — | atoms to minimize |
| `present` | str | `''` | atoms kept present but frozen as context |
| `state` | int | `-1` | state (-1 = current) |
| `fix` | str | `''` | atoms fixed in place |
| `restrain` | str | `''` | atoms restrained |
| `method` | str | `'mmff'` | minimization method |
| `async_` | int | `0` | run in background thread |
| `save_undo` | int | `1` | push an undo point first |
| `message` | str | `None` | status message shown while running |

### Behaviour
In upstream open-source PyMOL `clean` **raises `IncentiveOnlyException`** — the MMFF94 minimizer is
incentive-only (`packages/engine/modules/pymol/computing.py:20`). The Builder's `Clean` button is
therefore dead in the stock tree. The TS parity port supplies its own idealizer so `clean` runs.

### Examples
```
clean _builder_active
```

### Related
[fix_chemistry](#fix_chemistry), [Sculpting controls](#sculpting-controls)

### Source
`packages/engine/modules/pymol/computing.py:20`; `docs/builder.md` §6.1. Parity: implemented in the TS
port (`packages/engine-ts/src/cmd/sculpt.ts:394` `idealize`), unlike incentive-only upstream.

## invert

### Purpose
Invert the stereochemistry of the atom picked as `pk1`, holding the attached atoms `pk2` and `pk3`
immobile.

### Syntax
`invert(quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `quiet` | int | `1` | suppress feedback |

### Behaviour
Requires exactly `pk1`, `pk2`, `pk3` picked (origin + two stationary atoms). The C++ backend errors
*"Must pick atom to invert as pk1"* / *"Must pick immobile atom in pk2/pk3"* otherwise. The Builder's
`Invert` button and `InvertWizard` drive it; results are wrapped in a popup-on-exception handler.

### Examples
```
edit (id 1), (id 2), (id 3)
invert
```

### Related
[assign_stereo](#assign_stereo), [torsion](#torsion), [The Builder panel](#the-builder-panel)

### Source
`packages/engine/modules/pymol/editing.py:739`; `packages/engine/layer3/Editor.cpp:634`. Parity:
implemented (`packages/engine-ts/src/cmd/builder.ts:716`).

## Mutagenesis wizard

### Purpose
Interactively mutate a residue to another amino acid (or nucleotide) with side-chain rotamer
selection. Invoked as a wizard, not a bare command.

### Syntax
`wizard mutagenesis` (protein) / `wizard nucmutagenesis` (nucleic acids)

### Behaviour
Arms the Mutagenesis wizard: pick a residue, choose the target residue and a backbone-dependent
rotamer, and apply. It refuses to run while a movie is playing (*"Mutagenesis Wizard cannot be used
with Movie"*). Distinct from the [Builder panel](#the-builder-panel), which *grows* residues rather
than replacing them. Reachable from the GUI menu `Wizard > Mutagenesis > Protein / Nucleic Acids`.

### Examples
```
wizard mutagenesis
wizard nucmutagenesis
```

### Related
[fab](#fab), [The Builder panel](#the-builder-panel), `docs/wizards.md`

### Source
`packages/engine/modules/pymol/wizard/mutagenesis.py`, `.../nucmutagenesis.py`;
`docs/qt-main-window.md:386`. Parity: planned — wizards are not yet ported
(`docs/engine-port-gaps.md:272`).

## The Builder panel

### Purpose
A dockable GUI over the whole editing surface. Every button issues `cmd.*` calls — it holds no
chemistry logic of its own. Reach for it to grow molecules atom-by-atom, add residues/nucleotides,
set charges, fix hydrogens, create/delete bonds, and sculpt.

### Syntax / structure
A `QTabWidget` with three tabs plus three always-visible action rows:

- **Chemical** — element-replace buttons (`H C N O P S F Cl Br I`) via [replace](#replace); functional-group and cyclic/aromatic fragment buttons via `editor.attach_fragment` ([fragment](#fragment)+[fuse](#fuse)).
- **Protein** — 23 residue buttons via `editor.attach_amino_acid`, plus a secondary-structure combo (Alpha Helix / Beta Anti-Parallel / Beta Parallel -> `ss` 1/2/3).
- **Nucleic Acid** — nested DNA/RNA sub-tabs via `editor.attach_nuc_acid`, with Form (A/B) and Helix (single/double) radios (DNA only).
- **Action rows** — Atoms (`Fix H`->[h_fill](#h_fill), `Add H`->[h_add](#h_add), `Invert`->[invert](#invert), `Delete`->[remove_picked](#remove_picked), charge +1/0/-1 via [alter](#alter) `formal_charge`); Bonds (`Create`->[bond](#bond), `Delete`->[unbond](#unbond), `Cycle`->[cycle_valence](#cycle_valence), `|`/`||`/`|||`/`Arom`->[valence](#valence)); Model (`Clean`->[clean](#clean), `Sculpt`, `Fix`/`Rest` restraint flags, `Undo`/`Redo`).

### Behaviour
The key helper is `collectPicked` — the ordered subset of `pk1..pk4` that exists. Every action-row
button branches on it: **if atoms are already picked, act immediately; otherwise arm a wizard** that
prompts the user to click atoms in the viewport (13 action-wizard classes: Replace, Attach, AminoAcid,
NucleicAcid, Valence, Charge, Invert, Bond, Unbond, Hydrogen, Clean, Sculpt, Fix/Rest flags). Clicking
the same button twice cancels its wizard (`activateOrDismiss` toggle). On show the panel sets
`editor_auto_measure 0`, `auto_overlay`, `valence`, and `edit_mode 1`.

### Examples
```
# open the panel from the command line
builder
# most Builder buttons are just cmd calls, scriptable directly:
edit (name C and resi 10); attach O, 4, 2
```

### Related
[fab](#fab), [fnab](#fnab), [Sculpting controls](#sculpting-controls), [Mutagenesis wizard](#mutagenesis-wizard), `docs/builder.md`

### Source
`packages/engine/modules/pmg_qt/builder.py` (1579 lines), `packages/engine/modules/pymol/editor.py`;
`docs/builder.md`. Parity: implemented (`apps/web/src/features/builder/BuilderPanel.tsx`;
feature-parity Builder area 30/30).

## Sculpting controls

### Purpose
The Builder's `Sculpt`/`Clean`/`Fix`/`Rest` group runs real-time geometry relaxation and lets you pin
atoms during it. Sculpting nudges atoms toward ideal bond lengths/angles/VDW while you drag.

### Syntax
`sculpt_activate(object)` / `sculpt_deactivate(object)` / `sculpt_iterate(object, state, cycles)` plus
settings `sculpting`, `sculpt_field_mask`, `sculpt_vdw_vis_mode`.

### Behaviour
The `Sculpt` button activates sculpting on the picked object (`push_undo`, `sculpt_activate`,
`set sculpting 1`); the engine then iterates `ExecutiveSculptIterateAll` every idle tick, so atoms
relax with no client timer. `Fix` (flag 3) and `Rest` (flag 2) pin/restrain atoms via [flag](#the-builder-panel);
`El-stat` toggles `clean_electro_mode`; `Bumps` toggles `sculpt_vdw_vis_mode` to show VDW contact CGO.
`Scramble` randomizes unrestrained/unfixed coordinates via [alter_state](#alter_state). This is a
thin editing-side view of the [sculpting-minimization](../topics/sculpting-minimization.md) domain.

### Examples
```
sculpt_activate mymol
set sculpting, 1
# ... drag atoms, engine relaxes them ...
set sculpting, 0
```

### Related
[clean](#clean), [protect](#protect), [The Builder panel](#the-builder-panel), [sculpting-minimization](../topics/sculpting-minimization.md)

### Source
`docs/builder.md` §6.2; `packages/engine/layer5/PyMOL.cpp:2424`. Parity: implemented
(`packages/engine-ts/src/cmd/sculpt.ts`, `apps/web/src/features/builder/sculptTicker.ts`).
