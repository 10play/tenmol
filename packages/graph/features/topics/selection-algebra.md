---
name: selection-algebra
kind: feature
category: selecting
subcategory: selection language
summary: PyMOL's atom-selection mini-language — the property selectors, logical/set operators, proximity/expansion operators, and pseudo-selection keywords used everywhere a selection-expression is accepted.
parity: partial
---

## Purpose

Almost every PyMOL command takes a *selection-expression*: a small boolean query language over atoms.
You reach for it whenever you want to name, show, colour, measure, or edit a subset of a structure —
`select`, `show`, `color`, `hide`, `iterate`, `zoom`, `remove`, `distance`, and hundreds of others all
consume it. This reference covers the operators and keywords of that language, not the commands that
run it. The canonical keyword table lives in `packages/engine/layer3/Selector.cpp`; the TypeScript
parity port re-implements a large subset in `packages/engine-ts/src/select/selector.ts`.

## Syntax

A selection-expression is a boolean combination of *terms*. Each term is a keyword, a property
selector (`<prop> <values>`), a named/object reference, a slash-macro, or a parenthesised
sub-expression. Terms combine with `and`/`or`/`not`; **adjacent terms are implicitly ANDed**
(`chain A resi 5` == `chain A and resi 5`). Precedence, tightest first: unary/prefix set-ops
(`byres`, `not`) and postfix proximity (`within`, `around`) → `and`/`&` → `or`/`|`. An **empty**
selection means *all*.

Property values are `+`-separated lists (`name CA+CB+CG`), support `*`/`?` glob wildcards
(`resn A?A`, `name C*`), and — for `resi`/`index`/`id`/`rank` — numeric ranges (`resi 10-20`).
Matching is case-insensitive for text properties.

`select` creates a named selection from an expression:

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | unique name for the selection (or the expression itself if wrapped in parens) |
| `selection` | str | `''` | the selection-expression |
| `enable` | int | `-1` | show the selection indicator (`-1` = keep current) |
| `quiet` | int | `1` | suppress the atom-count message |
| `merge` | int | `0` | union into an existing selection of the same name |
| `state` | int | `0` | object state to test coordinate presence against (`0` = ignore) |
| `domain` | str | `''` | restrict the search to this pre-selection |

---

## name

`name <n>` / `n. <n>` — match by atom name (e.g. `CA`, `OP1`). Multi-valued and wildcard-capable:
`name CA+CB`, `name C*`. Case-insensitive.

## resn

`resn <n>` / `resname <n>` / `r. <n>` — match by residue (compound) name, e.g. `resn HIS`, `resn HOH+WAT`.

## resi

`resi <n>` / `residue <n>` / `resid <n>` / `i. <n>` — match by residue identifier (the PDB `resv`
number, optionally with an insertion code). Accepts `+`-lists and **numeric ranges** (`resi 10-20`,
`resi \-5-5` for negatives). A bare integer matches `resv`; a string form (`10A`) matches the literal `resi`.

## chain

`chain <c>` / `c. <c>` — match by chain identifier, e.g. `chain A`, `chain A+B`.

## segi

`segi <s>` / `segid <s>` / `segment <s>` / `s. <s>` — match by segment identifier (the mmCIF/PDB SEGID field).

## elem

`elem <x>` / `element <x>` / `symbol <x>` / `e. <x>` — match by chemical element symbol, e.g.
`elem C`, `elem N+O`. Distinct from `name`: `elem C` is every carbon, `name C` is only the backbone
carbonyl carbon.

## alt

`alt <x>` / `altloc <x>` — match by alternate-location identifier. An empty value (`alt ''`) matches
atoms with no altloc; `alt A` selects the A conformer.

## flag

`flag <n>` / `f. <n>` — match atoms carrying user/system flag number `n` (0–31; e.g. `flag 24` =
exclude, `flag 25` = ignore). Set via `cmd.flag`. *Not yet ported to the TS engine.*

## formal_charge

`formal_charge <cmp> <v>` / `fc. <cmp> <v>` — numeric comparison on the integer formal charge, e.g.
`fc. = 1`, `formal_charge < 0`. Comparison operators: `<`, `<=`, `>`, `>=`, `=`/`==`, `!=`.

## partial_charge

`partial_charge <cmp> <v>` / `pc. <cmp> <v>` — numeric comparison on the floating-point partial
charge, e.g. `pc. > 0.5`. Same operator set as `formal_charge`.

## b

`b <cmp> <v>` — numeric comparison on the B-factor / temperature-factor column, e.g. `b > 50`,
`b < 30`. Widely used to colour or hide by flexibility. Requires a comparison operator (it is a
two-operand selector, not a value list).

## q

`q <cmp> <v>` — numeric comparison on the occupancy column, e.g. `q = 1`, `q < 1` (partial occupancy).

## ss

`ss <type>` — match by secondary-structure assignment: `H` (helix), `S` (strand/sheet), `L` (loop).
Multi-valued: `ss H+S`. Assignments come from `dss` or the loaded file. Matching is a literal
alpha-list compare on the ssType string: PyMOL does **not** fold an unassigned `''` into `L`, so
`ss L` selects only atoms explicitly assigned `L`, while `ss ''` selects the unassigned ones (ported
to the TS engine to match this).

## index

`index <n>` / `idx. <n>` — match by 1-based atom index **within its object** (object-local, not stable
across edits). Accepts `+`-lists and ranges (`index 1-10`). Object-scoped, so usually written
`myobj and index 5`.

## id

`id <n>` / `ID <n>` — match by the atom's external ID (the PDB/mmCIF serial, preserved across sorting).
Accepts `+`-lists and ranges.

## rank

`rank <n>` — match by the atom's original load-order rank (stable per object regardless of subsequent
re-sorting). Accepts `+`-lists and ranges. *Not yet ported to the TS engine.*

## state

`state <n>` — match atoms belonging to object state `n` (used with multi-state / trajectory objects);
`-1` is the object's current state. An atom matches when its object owns a coordinate set for that
state. Ported to the TS engine (SELE_STAs).

## custom

`custom <v>` — match by the value of the `custom` per-atom string field (a free-form user annotation
column). *Not yet ported to the TS engine.*

## text_type

`text_type <v>` / `tt. <v>` — match by the MOL2/Tripos "text type" (atom type string), e.g.
`text_type C.ar`. Alpha/wildcard list match (SELE_TTYs) on the `textType` field, settable via
`alter sele, text_type='C.ar'`. Ported to the TS engine.

## numeric_type

`numeric_type <v>` / `nt. <v>` — match by the integer atom "numeric type" (legacy AMBER/type code).
Integer-list/range match (SELE_NTYs) on the `customType` field, settable via
`alter sele, numeric_type=N`; unset atoms carry the `cAtomInfoNoType` sentinel and match nothing.
Ported to the TS engine.

## and

`and` / `&` — set intersection; keep atoms matching **both** operands (`chain A and resn HIS`).
PyMOL also inserts an implicit `and` between adjacent terms.

## or

`or` / `|` — set union; keep atoms matching **either** operand (`resn HIS or resn ASP`). Note `+` is
also parsed as `or` at the top level to work around the historic `obj1+obj2` parsing bug.

## not

`not` / `!` — unary complement; every atom **not** matching the operand (`not solvent`, `!hydro`).
Binds tighter than `and`/`or`. The binary subtract form is written `A and not B` (or the `-` operator).

## in

`A in B` — keep atoms of `A` whose **identity** (same name/resi/chain/segi across objects) also appears
in `B`. Used to intersect two objects atom-by-atom rather than by coordinates. *Not yet ported to the
TS engine.*

## like

`A like B` / `A l. B` — like `in`, but matches on atom **name + numeric identifiers** only, so it pairs
corresponding atoms between objects that differ in chain/segi. *Not yet ported to the TS engine.*

## within

`A within <d> of B` / `A w. <d> of B` — atoms of `A` whose centre lies within `d` Å of any atom of `B`.
The prefix form `within <d> of B` uses `all` as `A`. Distance is centre-to-centre.

## around

`A around <d>` / `A a. <d>` — atoms within `d` Å of selection `A` **excluding `A` itself**. Classic
"give me the environment of this ligand": `resn LIG around 5`.

## expand

`A expand <d>` / `A x. <d>` — selection `A` **plus** everything within `d` Å of it (the union of `A`
and `A around d`). Distinct from `extend`/`xt.`, which grows by covalent bonds rather than distance.

## gap

`A gap <d>` — atoms **not** in `A` whose van-der-Waals surface clears every atom of `A` by at least
`d` Å (i.e. surface-to-surface distance ≥ `d`, using VDW radii). The inverse notion of a proximity
shell, measured on surfaces rather than centres.

## near_to

`A near_to <d> of B` / `A nto. <d> of B` — atoms of `A` within `d` Å of `B` but **excluding B itself**
(the binary counterpart of `around`). Prefix form uses `all` for `A`.

## beyond

`A beyond <d> of B` / `A be. <d> of B` — atoms of `A` **farther** than `d` Å from every atom of `B`
(the complement of `near_to`/`within`). Prefix form uses `all` for `A`.

## byres

`byres A` / `byresidue A` / `br. A` — expand `A` to every atom of every residue any of its atoms touch.
The most-used expander: `byres (resn LIG around 5)` grabs whole neighbouring residues.

## bychain

`bychain A` / `bc. A` — expand `A` to every atom of every chain it touches.

## byobject

`byobject A` / `byobj A` / `bo. A` — expand `A` to every atom of every object it touches.

## bymol

`bymol A` / `bymolecule A` / `bm. A` — expand `A` to every atom of every covalently-connected molecule
(bonded connected component) it touches.

## byfragment

`byfragment A` / `byfrag A` / `bf. A` — expand `A` to the editor's picked fragments (SELE_BYF1,
`EditorGetNFrag`), NOT the whole connected molecule. With no editor fragments defined it selects
nothing — the only state the TS engine models (so it is distinct from `bymol`, verified against the
oracle to return 0 on a freshly loaded structure).

## byring

`byring A` — atoms lying on a ring (smallest set of smallest rings, size ≤ 7) that contains a seed atom
of `A`. Mirrors PyMOL's `SelectorRingFinder`.

## bycalpha

`bycalpha A` / `bca. A` — the C-alpha atom (name `CA`, element `C`) of every residue `A` touches. The
selection-level equivalent used by `mouse_selection_mode` 6.

## neighbor

`neighbor A` / `nbr. A` — atoms directly bonded to `A`, **excluding `A`
itself**. `neighbor (name CA)` gives the atoms one bond away from every alpha carbon. See `bound_to`
for the seed-inclusive variant.

## bound_to

`bound_to A` / `bto. A` — atoms directly bonded to `A`, **retaining `A` itself** (the distinction from
`neighbor`, which drops the seed). A distinct opcode in PyMOL; the TS port currently aliases
`bound_to` to `neighbor`.

## bysegment

`bysegment A` / `byseg A` / `bs. A` — expand `A` to every atom of every **segment** (`segi`) it
touches. Parallels `bychain`/`byobject`. *Not yet ported to the TS engine.*

## bycell

`bycell A` — expand `A` to every atom lying in the same **crystallographic unit-cell** (the cell
index is the floor of the atom's fractional coordinates, from the `CRYST1` cell). Ported to the TS
engine (SELE_BYX1); atoms in objects without a cell are never selected. Verified against the oracle.

## extend

`A extend <d>` / `A xt. <d>` — grow `A` outward by `<d>` **covalent bonds** (integer steps along
bonds), not by Cartesian distance. Contrast `expand`, which grows by distance. *Not yet ported to the
TS engine.*

## first

`first A` — the single atom of `A` with the lowest internal table index (first in object/atom order);
`none` if `A` is empty. Handy for one representative atom, e.g. `first (resn LIG)`.

## last

`last A` — the single atom of `A` with the highest internal table index (last in order). Complement of
`first`.

## guide

`guide` — the "guide" atoms used for cartoon/ribbon tracing (protein C-alpha and nucleic C4'), i.e.
one representative atom per polymer residue. *Not yet ported to the TS engine.*

## pepseq

`pepseq <motif>` / `ps. <motif>` — select every atom of each residue in a consecutive stretch of
protein whose one-letter sequence matches the regular expression `<motif>` (`pepseq ACDE`,
`pepseq A.[ST]`).

## stereo

`stereo <x>` — match atoms by R/S chirality label (`stereo R`, `stereo S`); wildcard/`+`-list capable
like other text selectors. *Not yet ported to the TS engine.*

## delocalized

`delocalized` / `deloc.` — atoms participating in a delocalized (non-integer-order) bond, i.e. where
`floor(degree/valence) != degree/valence` (aromatic/resonant systems). Ported to the TS engine
(SELE_DESz), driven by the bond-order perception in the PDB loader (backbone carbonyls, aromatic
rings, guanidinium, nucleobases — the order half of `assign_pdb_known_residue`).

## cartoon_color

`cartoon_color <n>` — atoms whose per-atom `cartoon_color` setting equals colour `<n>` (index or
name); the cartoon-specific analogue of `color`. *Not yet ported to the TS engine.*

## ribbon_color

`ribbon_color <n>` — atoms whose per-atom `ribbon_color` setting equals colour `<n>`. *Not yet ported
to the TS engine.*

## label

`label <text>` — atoms carrying a rendered label whose string matches `<text>` (wildcards allowed).
*Not yet ported to the TS engine.*

## property

`p.<key> <cmp> <v>` — match on a user-defined per-atom **property** in the `properties`/`p.` namespace,
e.g. `p.score > 3`. Generic accessor for custom numeric/string properties attached to atoms. *Not yet
ported to the TS engine.*

## all

`all` / `*` — every atom in every loaded object. Also the value of an empty selection-expression.

## none

`none` — the empty set. Useful as an identity for accumulating unions or to blank a selection.

## hetatm

`hetatm` / `het` — atoms flagged as heteroatoms (the PDB `HETATM` records): ligands, ions, waters, and
other non-standard groups.

## hydro

`hydro` / `hydrogens` / `h.` — all hydrogen (and deuterium) atoms. `not hydro` is the standard
heavy-atom filter.

## polymer

`polymer` / `pol.` — atoms belonging to a biopolymer (protein or nucleic acid) backbone/residue,
excluding solvent and small-molecule heteroatoms. The TS port approximates this as "standard residue,
not solvent, not hetatm".

## polymer.protein

`polymer.protein` / `protein` / `pro.` — the protein subset of `polymer`. *Not yet ported to the TS
engine* (the port treats all polymer as one class).

## polymer.nucleic

`polymer.nucleic` / `nucleic` / `nuc.` — the nucleic-acid subset of `polymer`. *Not yet ported to the
TS engine.*

## solvent

`solvent` / `sol.` — solvent atoms, primarily water (`HOH`, `WAT`, `H2O`, `TIP`, `SOL`). `remove
solvent` is the usual water-stripping idiom.

## organic

`organic` / `org.` — small organic molecules (typical ligands): carbon-containing non-polymer,
non-solvent groups. *Not yet ported to the TS engine.*

## inorganic

`inorganic` / `ino.` — inorganic groups: ions and other non-carbon non-polymer atoms. *Not yet ported
to the TS engine.*

## metals

`metals` — atoms whose element is a metal (Li, Na, Mg, K, Ca, Fe, Zn, … — the periodic-table metals).

## backbone

`backbone` / `bb.` — polymer backbone atoms (protein `N/CA/C/O/OXT`; nucleic `P/OP1/OP2/O5'/C5'/…`).
Complement of `sidechain` within `polymer`.

## sidechain

`sidechain` / `sc.` — polymer non-backbone atoms (the side chains). Complement of `backbone` within
`polymer`.

## donors

`donors` / `don.` / `hbd.` — candidate hydrogen-bond donor atoms carrying the perceived `hb_donor`
flag. The TS port reproduces PyMOL's chemistry perception (InferChemFromBonds → InferHBondFromChem):
donors are atoms with an implicit/explicit hydrogen (metals, amine/hydroxyl/water N and O, …), NOT a
bare N/O element test — verified against the oracle.

## acceptors

`acceptors` / `acc.` / `hba.` — candidate hydrogen-bond acceptor atoms carrying the perceived
`hb_acceptor` flag (every uncharged O, delocalized N, …). Ported via the same perception pass as
`donors` and verified against the oracle.

## visible

`visible` / `v.` — atoms with at least one representation currently shown (any `visRep` bit set).

## enabled

`enabled` — atoms belonging to an object that is currently enabled (shown) in the object panel.

## present

`present` / `pr.` — atoms that have coordinates in the current (or requested) state. In a single-state
context every loaded atom qualifies; it matters for multi-state objects with missing coordinates.

## masked

`masked` / `msk.` — atoms with the "mask" flag set (protected from mouse picking/editing). *Not yet
ported to the TS engine.*

## protected

`protected` — atoms with the "protect" flag set (excluded from sculpting/movement). *Not yet ported to
the TS engine.*

## fixed

`fixed` / `fxd.` — atoms carrying the *fix* flag (flag 3), held in place during sculpting. *Not yet
ported to the TS engine.*

## restrained

`restrained` / `rst.` — atoms carrying the *restrain* flag (flag 2), tethered to reference coordinates
during sculpting. *Not yet ported to the TS engine.*

## center

`center` — a pseudo-atom at the current camera/scene centre (used with proximity operators, e.g.
`center around 10`). *Not yet ported to the TS engine.*

## origin

`origin` — a pseudo-atom at the current rotation origin. Like `center`, meant for distance queries.
*Not yet ported to the TS engine.*

## bonded

`bonded` — atoms that participate in at least one bond (excludes isolated ions/waters). `not bonded`
isolates lone atoms.

## rep

`rep <name>` — atoms for which representation `<name>` is currently shown, e.g. `rep sticks`,
`rep cartoon`, `rep surface`. `wire` is accepted as an alias of `lines`. Tests the per-atom `visRep` bit.

## color

`color <n>` — atoms whose colour equals `<n>`, given either as a numeric colour index or a named colour
(`color red`, `color 4`). Resolved against the colour table.

## coordinate ranges

`x <cmp> <v>`, `y <cmp> <v>`, `z <cmp> <v>` — numeric comparison on an atom's Cartesian coordinate in
the current model frame, e.g. `z > 0`, `x < 10`. Slab-style spatial filtering. *Not yet ported to the
TS engine.*

## named selections

A bare token that is not a keyword is treated as a **reference**: first a previously stored named
selection (created with `select`/`%name`), otherwise an **object name**. `%name` forces the named-
selection interpretation; `?name` makes a missing name resolve to `none` instead of erroring. `model X`
/ `object X` / `m.`/`o.` explicitly qualify by object. Selection names are just atom sets and update
lazily as referenced.

## wildcards

Text property values support glob wildcards: `*` matches any run of characters and `?` matches one
character (`name C*`, `resn A?A`, `chain *`). Matching is case-insensitive. Wildcards apply to
`name/resn/resi/chain/segi/elem/alt` value specs, not to numeric comparisons.

## resi ranges

For `resi`, `index`, `id`, and `rank`, a value part of the form `lo-hi` is a **numeric range**
(inclusive), combinable with `+`-lists: `resi 10-20+30-40`, `index 1-100`. Negative bounds are allowed
(`resi \-3-3`). Non-numeric residue identifiers (insertion codes) fall back to literal matching.

## slash macro

The slash macro is positional shorthand for object/segi/chain/resi/name. With a **leading** slash the
fields left-align: `/object/segi/chain/resi/name` (`/1abc//A/45/CA`). Without a leading slash they
right-align, ending at `name`: `chain/resi/name`, `resi/name`, or just `resi`. Empty segments and `*`
are wildcards (no constraint); present fields are ANDed together.

## Examples

```python
# Whole residues within 5 A of a ligand, excluding the ligand
select pocket, byres (resn LIG around 5) and polymer

# Backbone atoms of chain A, residues 10-25, coloured by B-factor threshold
color red, chain A and resi 10-25 and backbone and b > 40

# Slash macro: the CA of residue 142 in object 1abc
zoom /1abc//A/142/CA
```

## Related

- [select](../commands/select.md) — create a named selection from an expression
- [iterate](../commands/iterate.md) / [alter](../commands/alter.md) — run Python per selected atom
- [flag](../commands/flag.md) — set the flags queried by `fixed`/`restrained`/`masked`/`protected`
- [dss](../commands/dss.md) — assign the secondary structure queried by `ss`

## Source

Keyword/alias table and operator semantics: `packages/engine/layer3/Selector.cpp:326-405` (opcodes)
and `:419-687` (keyword strings). Command wrapper and `selector.process` preprocessing:
`packages/engine/modules/pymol/selecting.py:49` (`select`), `:176` (`indicate`), `:27` (`deselect`).
TypeScript parity port (parser + evaluator for the covered subset):
`packages/engine-ts/src/select/selector.ts` — property/keyword tables `:111-189`, parser `:204-436`,
slash macro `:460-486`, evaluator `:791-946`.

Parity note: the TS engine implements the common corpus (property selectors, `and/or/not`, all
distance operators, `byres/bychain/byobject/bymol/byfragment/byring/bycalpha/neighbor`, `first`,
`last`, `pepseq`, `state`, `text_type`, `numeric_type`, `delocalized`, `ss`, and most
pseudo-selections; `byfragment` returns the editor's picked fragments (empty without them);
`bound_to` is aliased to `neighbor`). Not yet ported:
`custom`, `bysegment`, `stereo`, `cartoon_color`, `ribbon_color`, `label`, the `p.` custom
property selector, and `center`, `origin` (need scene-origin tracking).
