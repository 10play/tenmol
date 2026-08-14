---
name: presets
kind: feature
category: presets
subcategory: display presets
summary: One-click representation presets (`cmd.preset.*`) that hide/show reps, recolor, and tweak a handful of settings to establish a named visual state on a selection.
parity: implemented
---

## Purpose
Presets are pure orchestration verbs in the `preset` module: each one drives a fixed
sequence of `hide`/`show`/`color`/`set` calls to put a selection into a recognizable
visual state (a clean ribbon overview, a ligand-binding-site view, a publication-quality
cartoon, a B-factor putty, etc.). They compute no geometry themselves — they compose
already-existing lower-level verbs. Reach for a preset when you want a good-looking
starting point without hand-configuring representations. All presets are exposed as
`cmd.preset.<name>(selection)` and wired into the internal "A > preset" menu.

Every preset first calls the shared `_prepare` helper, which names the target as the
scratch selection `_p_tmp`, resets cartoons to `auto`, hides everything, clears
`two_sided_lighting`, and unsets the per-object settings a previous preset may have left
(transparency, surface_quality/type, sphere_scale, stick_radius/color, and the cartoon_*
family). This is why applying any preset overwrites the effect of a prior one.

Selection macros used throughout (verbatim module-level strings):
- `prot_and_dna` — the standard protein + nucleic residue-name list.
- `wat_sele` = `solvent`; `ion_sele` = `(resn CA,HG,K,NA,ZN,MG,CL)`; `solv_sele` = `(solvent|ion)`.
- `lig_sele` = `((hetatm or not prot_and_dna) and not (solv|ion|MSE))` — the ligand set.
- `lig_and_solv_sele` = `(lig|solv)`.

Color helpers (from `util`): `cbc` = color by chain; `chainbow` = per-chain rainbow spectrum
by residue; `cnc` = color non-carbon atoms by element (carbons untouched); `cbac` = non-carbon
by element + carbon cyan; `cbag` = non-carbon by element + carbon green.

## Syntax
Every preset takes a single `selection` argument (default `'(all)'`) except where noted.
Invoke as `preset.<name>(selection)`.

| Preset | Signature |
| --- | --- |
| `simple` | `simple(selection='(all)')` |
| `simple_no_solv` | `simple_no_solv(selection='(all)')` |
| `ligands` | `ligands(selection='(all)')` |
| `ligand_sites` | `ligand_sites(selection='(all)')` |
| `ligand_sites_hq` | `ligand_sites_hq(selection='(all)')` |
| `ligand_sites_trans` | `ligand_sites_trans(selection='(all)')` |
| `ligand_sites_trans_hq` | `ligand_sites_trans_hq(selection='(all)')` |
| `ligand_sites_mesh` | `ligand_sites_mesh(selection='(all)')` |
| `ligand_sites_dots` | `ligand_sites_dots(selection='(all)')` |
| `ligand_cartoon` | `ligand_cartoon(selection='(all)')` |
| `ball_and_stick` | `ball_and_stick(selection='(all)', mode=1)` |
| `b_factor_putty` | `b_factor_putty(selection='(name CA+P)')` |
| `technical` | `technical(selection='(all)')` |
| `pretty` | `pretty(selection='(all)', *, solv=False)` |
| `pretty_solv` | `pretty_solv(selection='(all)')` |
| `pretty_no_solv` | `pretty_no_solv(selection='(all)')` (alias of `pretty`) |
| `publication` | `publication(selection='(all)', *, solv=False)` |
| `pub_solv` | `pub_solv(selection='(all)')` |
| `pub_no_solv` | `pub_no_solv(selection='(all)')` (alias of `publication`) |
| `default` | `default(selection='(all)')` |
| `interface` | `interface(selection='*')` |
| `classified` | `classified(selection='*')` |

## Behaviour

### simple
Color-by-chain ribbon overview with disulfides and ligands picked out.
Sequence: `_prepare`; `util.cbc`; `show ribbon`; `show lines` on the CA/CB/SG atoms of
bonded CYS/CYX pairs (disulfides); `show sticks` on covalent ligands (`lig_sele extend 2`)
and `byres` of nearby ligands (`extend 1`, excluding capping residues ACE/NAC/NME/NH2);
`hide sticks` on atoms merely one bond past a shown region; re-`show sticks` on ligands;
`util.cnc` on any shown lines/sticks and all ligand/solvent atoms; `show nonbonded` and
`show lines` on ligand+solvent. Deletes the scratch selection.

### simple_no_solv
Runs `simple`, then re-selects the target and `hide everything` on the solvent set
(`solv_sele`), i.e. the same view without waters/ions shown.

### ligands
Ligand-centric view without a surface. Via the shared ligand core: builds `_preset_host`
(protein/DNA), `_preset_solvent`, `_preset_lig`, and `_preset_solvent within 4 of lig`;
`util.chainbow` the host, `util.cbc` the ligand, `util.cbac` non-carbons; `hide everything`;
`show ribbon` host; `show lines` on host residues `within 5` of ligand; `show sticks` on the
ligand and on solvent neighboring the ligand; when the ligand is non-empty, computes H-bonds
via `dist(..., mode=2, label=0, reset=1)` into the polar-contacts object, enables it, hides
its labels and shows dashes; `show nonbonded` on lig|host|near-solvent; `zoom` to the ligand
(animated). Deletes the scratch selections.

### ligand_sites
Same as `ligands` but with a molecular surface over the pocket (the "solid" surface variant,
and the base for all `ligand_sites_*`). Additionally sets `flag ignore` off for the host and on
for lig|solvent (so the surface is computed on the host only); `show surface` on host lines
expanded 4 and `within 6` of ligand; `set two_sided_lighting 1` (global), `set transparency 0`,
`set surface_quality 0`; shows `nb_spheres` (instead of nonbonded) on lig|host|near-solvent plus
`lines` on near-solvent (nb_spheres won't show solvent hydrogens). Returns the scratch selection
so the quality/type variants below can further tweak it.

### ligand_sites_hq
`ligand_sites` then `set surface_quality 1`, `set surface_type 0` — high-quality solid surface.

### ligand_sites_trans
`ligand_sites`, converts the pocket lines to sticks (`show sticks` on `rep lines`, `hide lines`),
then `set transparency 0.33`, `set surface_type 0`, `set surface_quality 0` — transparent solid surface.

### ligand_sites_trans_hq
As `ligand_sites_trans` but `set surface_quality 1` — transparent, high-quality surface.

### ligand_sites_mesh
`ligand_sites`, lines→sticks, then `set surface_type 2`, `set surface_quality 0` — mesh surface.

### ligand_sites_dots
`ligand_sites`, lines→sticks, then `set surface_type 1`, `set surface_quality 1` — dot surface.

### ligand_cartoon
`ligand_sites` (surface pocket), then `set cartoon_side_chain_helper 1`, promote the ribbon to
cartoon (`show cartoon` on `rep ribbon`), `hide ribbon`, and `hide surface` — a cartoon-based
binding-site view without the surface.

### ball_and_stick
`_prepare`, then for `mode=1` (default): `hide everything`; `set_bond stick_color white`;
`set_bond stick_radius 0.14`; `set sphere_scale 0.25`; `show sticks`; `show spheres`.
For `mode=2`: white thin sticks (`stick_radius -0.14`) with `stick_ball 1`,
`stick_ball_ratio -1.0`, `stick_ball_color atomic`, `show sticks`.

### b_factor_putty
`_prepare`, then re-select the CA/P backbone atoms present in the selection; `show cartoon`;
`set cartoon_flat_sheets 0`; `cartoon putty`; `spectrum b` (rainbow) over the selection —
a B-factor-colored putty tube.

### technical
Detailed all-atom "technical" view. `_prepare`; `util.chainbow` the whole selection; `util.cbc`
ligands; `util.cbac` non-carbons; `show nonbonded`; `show lines` on the non-ligand part
(`extend 1`); `show sticks` on ligands; `show ribbon`; compute intramolecular H-bonds via `dist`,
enable them with `dash_width 1.5`, hide labels, show dashes; `show nonbonded` on ligands + waters.

### pretty
Nice cartoon with rainbow-spectrum chains and stick ligands. `_prepare`; `dss(preserve=1)`
to assign secondary structure; `cartoon auto`; `show cartoon`; show sticks on ligands (or
`licorice` on ligands+waters when `solv=True`); `util.cbc`/`util.cbac` the ligand;
`spectrum count` over the protein carbons; then sets `cartoon_highlight_color -1`,
`cartoon_fancy_helices 0`, `cartoon_smooth_loops 0`, `cartoon_flat_sheets 1`,
`cartoon_side_chain_helper 0`.

### pretty_solv
`pretty(solv=True)` — same as `pretty` but also draws waters (and ligands) as licorice.

### pretty_no_solv
Module-level alias `pretty_no_solv = pretty`; identical to `pretty` (solvent off).

### publication
`pretty(solv=solv)` first, then applies the publication-quality cartoon overrides:
`cartoon_smooth_loops 1`, `cartoon_highlight_color grey50`, `cartoon_fancy_helices 1`,
`cartoon_flat_sheets 1`, `cartoon_side_chain_helper 0`.

### pub_solv
`publication(solv=True)` — publication cartoon with solvent licorice.

### pub_no_solv
Module-level alias `pub_no_solv = publication`; publication cartoon, solvent off.

### default
The plain default representation. `_prepare`; `show lines`; `show nonbonded`; then reads the
object's color index: if unset (`<0`) it colors carbons green by element (`util.cbag`);
otherwise it colors non-carbons by element (`util.cnc`) and colors the object's carbons the
stored object color.

### interface
Protein-protein interface preset (mimics the BioLuminate preset). `_prepare`; select interface
atoms as those `around 4.5` of any other chain; `util.cbc`; color non-carbons `atomic`;
`show_as cartoon`; show interface residues as `byres` sticks and `nb_spheres`.

### classified
Equivalent of the `auto_show_classified` setting — sets representations from atom classification
without touching colors or settings: `show_as cartoon` on `polymer`, `show_as sticks` on
`organic`, `show_as spheres` on `inorganic`.

### _prepare (internal helper)
Not a preset. Names the target as `_p_tmp`, resets cartoons to `auto`, hides everything, clears
the global `two_sided_lighting`, and unsets the per-object settings (`transparency`,
`surface_quality`, `surface_type`, `sphere_scale`, `stick_radius`/`stick_color`, and the
`cartoon_*` overrides), plus deletes any stale auto-named polar-contacts object. Returns the
scratch selection name, resolved object name, and the polar-contacts (distance) object name.

### get_sname_oname_dname (internal helper)
Not a preset. Resolves a selection into `(_p_tmp, object-name(s), polar-contacts-name)`: it
selects `_p_tmp`, derives the object list, and names the polar-contacts object
`<object>_pol_conts` for a single object or `polar_contacts` otherwise.

## Examples
```python
preset.simple('all')
preset.ligand_sites('protein')      # solid surface over the binding pocket
preset.publication('polymer')       # publication-quality cartoon
preset.b_factor_putty               # rainbow B-factor putty over CA/P
```

## Related
- [show](../commands/show.md) / hide — the representation verbs presets orchestrate
- [set](../commands/set.md) — the per-object settings presets toggle
- [spectrum](../commands/spectrum.md) — used by `pretty`/`b_factor_putty`
- [dss](../commands/dss.md) — secondary-structure assignment used by `pretty`
- [cartoon](../commands/cartoon.md) — cartoon-type selection (auto/putty)

## Source
`packages/engine/modules/pymol/preset.py` (all preset functions). Color helpers in
`packages/engine/modules/pymol/util.py:442-809`. Parity port:
`packages/engine-ts/src/cmd/preset.ts` (registers `preset.*`; several steps — `flag`,
`set_bond`, `unset`, `dist`/`enable`, `util.chainbow`/`util.cnc`, and `extend`/`licorice`
grammar — are still unported and are skipped via a `soft` wrapper, mirroring PyMOL's own
try/except around the ligand presets).
