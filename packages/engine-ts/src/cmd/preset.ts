/**
 * One-click representation presets (`cmd.preset.*`) — ported from
 * `modules/pymol/preset.py`. A preset is pure orchestration: it hides/shows
 * representations, recolours, and tweaks a handful of settings on a selection.
 * Nothing here computes geometry directly; every effect is expressed by
 * composing the already-ported lower-level verbs through {@link RegistrarCtx}.
 *
 * Registers its handlers through the shared {@link RegistrarCtx}. Orchestration
 * verbs compose lower-level commands via `ctx.call(...)`; each registered
 * `preset.*` verb ends with `ctx.publish()` so the geometry/objects re-emit.
 *
 * FIDELITY NOTE. Several PyMOL preset steps use verbs this slice has not ported
 * yet (`flag`, `set_bond`, `unset`, `unset_bond`, `dist`, `enable`,
 * `util.chainbow`, `util.cnc`) or selection grammar it does not parse yet
 * (`extend`, the `licorice` rep alias). Rather than abort the whole preset when
 * one such step is hit, every composed step runs through {@link soft}, which
 * swallows ONLY a `NotPorted` throw (unported verb) or a `SelectorError` throw
 * (grammar not in the slice) — every step whose verb AND grammar are available
 * is applied faithfully. Any other error propagates. This mirrors PyMOL's own
 * `try/except` around the ligand presets.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* --------------------------------------------------------------------------
 * Selection macros (verbatim from preset.py's module-level strings). The comma
 * lists in `ion_sele` are copied as-authored; residue/hetero classification is
 * only as good as the slice's selector, but the well-behaved cases (protein,
 * nucleic, plain hetero ligands) resolve correctly.
 * ------------------------------------------------------------------------ */

const PROT_AND_DNA =
  '(resn ALA+CYS+CYX+ASP+GLU+PHE+GLY+HIS+HID+HIE+HIP+HISE+HISD+HISP+ILE+LYS+' +
  'LEU+MET+MSE+ASN+PRO+GLN+ARG+SER+THR+VAL+TRP+TYR+A+C+T+G+U+DA+DC+DT+DG+DU+DI)';
const WAT = 'solvent';
const ION = '(resn CA,HG,K,NA,ZN,MG,CL)';
const SOLV = `(${WAT}|${ION})`;
const LIG_EXCL = '(resn MSE)';
const LIG = `((hetatm or not ${PROT_AND_DNA}) and not (${SOLV}|${ION}|${LIG_EXCL}))`;
const LIG_AND_SOLV = `(${LIG}|${SOLV})`;

/** The scratch named-selection name PyMOL uses (`tmp_sele`). */
const TMP = '_p_tmp';

export function registerPreset(ctx: RegistrarCtx): void {
  const { str } = ctx;

  /**
   * Run one composed step, swallowing only the two "not in the slice yet"
   * failures — an unported verb (`NotPorted`) or unparseable selection grammar
   * (`SelectorError`). Any other error is a genuine bug and propagates.
   */
  const soft = (name: string, args: readonly unknown[]): void => {
    try {
      ctx.call(name, args);
    } catch (err) {
      const type = (err as { type?: string } | null)?.type;
      if (type === 'NotPorted' || type === 'SelectorError') return;
      throw err;
    }
  };

  /** Read a verb's result, returning a fallback if it is unported/unparseable. */
  const softGet = (name: string, args: readonly unknown[], dflt: Json): Json => {
    try {
      return ctx.call(name, args);
    } catch (err) {
      const type = (err as { type?: string } | null)?.type;
      if (type === 'NotPorted' || type === 'SelectorError') return dflt;
      throw err;
    }
  };

  /**
   * Port of `preset._prepare`: name the target as the scratch selection `TMP`,
   * reset cartoons, hide everything, and undo the per-object settings a prior
   * preset may have left. The `unset*`/`unset_bond` resets and the stale
   * polar-contacts delete are unported verbs, so {@link soft} skips them.
   * Returns the scratch selection name (used as `s` everywhere below).
   */
  const prepare = (selection: string): string => {
    soft('select', [TMP, selection]);
    soft('cartoon', ['auto', TMP]);
    soft('hide', ['everything', TMP]);
    soft('set', ['two_sided_lighting', 0]); // global
    return TMP;
  };

  /** `cmd.delete(s)` — drop a scratch selection when the preset is done. */
  const drop = (name: string): void => soft('delete', [name]);

  /* ------------------------------- simple ------------------------------- */

  const simple = (selection: string): void => {
    const s = prepare(selection);
    soft('util.cbc', [s]);
    soft('show', ['ribbon', s]);
    // Disulfide bridges as lines.
    soft('show', [
      'lines',
      `(byres ((${s} & r. CYS+CYX & n. SG) & bound_to (${s} & r. CYS+CYX & n. SG))) & n. CA+CB+SG`,
    ]);
    // Covalent ligands and what they connect to (`extend` grammar unported → skipped).
    soft('show', ['sticks', `(${LIG} and (${s})) extend 2`]);
    soft('show', ['sticks', `byres ((${LIG} and (${s}) and not resn ACE+NAC+NME+NH2) extend 1)`]);
    soft('hide', ['sticks', `(${s}) and ((not rep sticks) extend 1)`]);
    soft('show', ['sticks', `(${LIG} and (${s})) extend 2`]);
    // Colour by atom where lines/sticks are shown (util.cnc unported → skipped).
    soft('util.cnc', [`(( rep lines or rep sticks or (${LIG_AND_SOLV})) and (${s}))`]);
    soft('show', ['nonbonded', `(${LIG_AND_SOLV} and (${s}))`]);
    soft('show', ['lines', `(${LIG_AND_SOLV} and (${s}))`]);
    drop(s);
  };

  const simpleNoSolv = (selection: string): void => {
    simple(selection);
    soft('select', [TMP, selection]);
    soft('hide', ['everything', `(${SOLV} and ${TMP})`]);
    drop(TMP);
  };

  /* ------------------------------- ligands ------------------------------ */

  const HOST = '_preset_host';
  const SOLVENT = '_preset_solvent';
  const NEAR = '_preset_near';
  const LIGSEL = '_preset_lig';

  /**
   * Shared body of `ligands`/`ligand_sites`: build the host/solvent/ligand
   * scratch selections, colour them, and show ribbon + interacting lines +
   * ligand sticks. `withSurface` adds the ligand-site surface and nb_spheres.
   * The H-bond distance object, the `flag ignore` masking and `util.chainbow`
   * are unported verbs, so {@link soft} skips them. Leaves `s` alive for callers.
   */
  const ligandCore = (selection: string, withSurface: boolean): string => {
    const s = prepare(selection);
    soft('select', [HOST, `${s} and ${PROT_AND_DNA}`]);
    soft('select', [SOLVENT, `${s} and ${SOLV}`]);
    soft('select', [LIGSEL, `${s} and ${LIG}`]);
    soft('select', [NEAR, `${s} and (${SOLVENT} within 4 of ${LIGSEL})`]);
    if (withSurface) {
      soft('flag', ['ignore', HOST, 'clear']); // unported
      soft('flag', ['ignore', `${LIGSEL}|${SOLVENT}`, 'set']); // unported
    }
    soft('util.chainbow', [HOST]); // unported
    soft('util.cbc', [LIGSEL]);
    soft('util.cbac', [`((${s}) and not elem C)`]);
    soft('hide', ['everything', s]);
    soft('show', ['ribbon', HOST]);
    soft('show', ['lines', `(${s} and byres (${HOST} within 5 of ${LIGSEL}))`]);
    if (withSurface) {
      soft('show', ['surface', `(${s} and ((rep lines expand 4) within 6 of ${LIGSEL}))`]);
      soft('set', ['two_sided_lighting', 1]); // global
      soft('set', ['transparency', 0]);
      soft('set', ['surface_quality', 0]);
    }
    soft('show', ['sticks', LIGSEL]);
    soft('show', ['sticks', `${SOLVENT} and neighbor ${LIGSEL}`]);
    soft('show', ['lines', `(${s} and (rep lines extend 1) and ${LIGSEL})`]);
    // H-bond distances (cmd.dist / enable) unported → skipped.
    if (withSurface) {
      soft('show', ['nb_spheres', `${LIGSEL}|${HOST}|${NEAR}`]);
      soft('show', ['lines', NEAR]);
    } else {
      soft('show', ['nonbonded', `${LIGSEL}|${HOST}|${NEAR}`]);
    }
    soft('zoom', [LIGSEL, 3]);
    drop(HOST);
    drop(SOLVENT);
    drop(NEAR);
    drop(LIGSEL);
    return s;
  };

  const ligands = (selection: string): void => {
    const s = ligandCore(selection, false);
    drop(s);
  };

  /** `ligand_sites` — the surfaced variant; leaves `s` for the *_hq/_trans/... callers. */
  const ligandSites = (selection: string): string => ligandCore(selection, true);

  const ligandCartoon = (selection: string): void => {
    const s = ligandSites(selection);
    soft('set', ['cartoon_side_chain_helper', 1]);
    soft('show', ['cartoon', 'rep ribbon']);
    soft('hide', ['ribbon']);
    soft('hide', ['surface']);
    drop(s);
  };

  /** The ligand_sites_* surface-quality/type variants: run the base then tweak. */
  const ligandSitesVariant = (
    selection: string,
    steps: ReadonlyArray<readonly [string, number]>,
    showSticksFromLines: boolean,
  ): void => {
    const s = ligandSites(selection);
    if (showSticksFromLines) {
      soft('show', ['sticks', `${s} and rep lines`]);
      soft('hide', ['lines', `${s} and rep lines`]);
    }
    for (const [name, value] of steps) soft('set', [name, value]);
    drop(s);
  };

  /* --------------------------- ball_and_stick --------------------------- */

  const ballAndStick = (selection: string): void => {
    const s = prepare(selection);
    // mode == 1 (the default). set_bond stick_* are unported → skipped.
    soft('hide', ['everything', s]);
    soft('set_bond', ['stick_color', 'white', s, s]);
    soft('set_bond', ['stick_radius', '0.14', s, s]);
    soft('set', ['sphere_scale', 0.25]);
    soft('show', ['sticks', s]);
    soft('show', ['spheres', s]);
    drop(s);
  };

  /* ---------------------------- b_factor_putty -------------------------- */

  const bFactorPutty = (selection: string): void => {
    const s = prepare(selection);
    soft('select', [s, `(name CA+P) and (${selection}) and present`]);
    soft('show', ['cartoon', s]);
    soft('set', ['cartoon_flat_sheets', 0]);
    soft('cartoon', ['putty', s]);
    soft('spectrum', ['b', 'rainbow', s]);
    drop(s);
  };

  /* ------------------------------ technical ----------------------------- */

  const technical = (selection: string): void => {
    const s = prepare(selection);
    soft('util.chainbow', [s]); // unported
    soft('util.cbc', [`(${LIG} and (${s}))`]);
    soft('util.cbac', [`((${s}) and not elem C)`]);
    soft('show', ['nonbonded', s]);
    soft('show', ['lines', `(((${s}) and not ${LIG}) extend 1)`]);
    soft('show', ['sticks', `(${LIG} and (${s}))`]);
    soft('show', ['ribbon', s]);
    // H-bond distances (dist/enable/dash_width) unported → skipped.
    soft('show', ['nonbonded', `((${LIG}|resn HOH+WAT+H2O) and (${s}))`]);
    drop(s);
  };

  /* --------------------------- pretty / publication --------------------- */

  const pretty = (selection: string, solv: boolean): void => {
    const s = prepare(selection);
    soft('dss', [s]);
    soft('cartoon', ['auto', s]);
    soft('show', ['cartoon', s]);
    if (solv) {
      // `licorice` is an unported rep alias → skipped; sticks stand in below.
      soft('show', ['licorice', `(${LIG}|${WAT}) and ${s}`]);
    } else {
      soft('show', ['sticks', `(${LIG}) and ${s}`]);
    }
    soft('util.cbc', [`(${LIG} and (${s}))`]);
    soft('util.cbac', [`(${LIG} and (${s}) and not elem C)`]);
    soft('spectrum', ['count', 'rainbow', `(elem C and (${s}) and not ${LIG})`]);
    soft('set', ['cartoon_highlight_color', -1]);
    soft('set', ['cartoon_fancy_helices', 0]);
    soft('set', ['cartoon_smooth_loops', 0]);
    soft('set', ['cartoon_flat_sheets', 1]);
    soft('set', ['cartoon_side_chain_helper', 0]);
    drop(s);
  };

  const publication = (selection: string, solv: boolean): void => {
    pretty(selection, solv);
    // Settings are global in the slice, so apply the publication overrides directly.
    soft('set', ['cartoon_smooth_loops', 1]);
    soft('set', ['cartoon_highlight_color', 'grey50']);
    soft('set', ['cartoon_fancy_helices', 1]);
    soft('set', ['cartoon_flat_sheets', 1]);
    soft('set', ['cartoon_side_chain_helper', 0]);
  };

  /* ------------------------------- default ------------------------------ */

  const defaultPreset = (selection: string): void => {
    const s = prepare(selection);
    soft('show', ['lines', s]);
    soft('show', ['nonbonded', s]);
    // `get_object_color` returns the object's colour index, or -1 when the object
    // is at its default colour (the common case). The stub `get_object_color_index`
    // always returns 0, which made this branch dead and coloured nothing — see
    // display.ts. -1 => colour carbons green by element (cbag); a set colour =>
    // colour non-carbons by element and leave carbon the object colour (cnc).
    const color = Number(softGet('get_object_color', [selection], -1));
    if (color < 0) {
      soft('util.cbag', [selection]);
    } else {
      soft('util.cnc', [selection]);
    }
    drop(s);
  };

  /* ------------------------------ interface ----------------------------- */

  const interfacePreset = (selection: string): void => {
    const s = prepare(selection);
    soft('util.cbc', [s]);
    soft('color', ['atomic', `(${s}) and not elem C`]);
    soft('as', ['cartoon', s]);
    // Interface = atoms within 4.5 Å across a chain boundary.
    const chainsJson = softGet('get_chains', [s], []);
    const chains = Array.isArray(chainsJson) ? chainsJson.map((c) => String(c)) : [];
    if (chains.length > 0) {
      const iface = '_iface';
      const around = chains.map((c) => `(chain ${c}) around 4.5`).join(' or ');
      soft('select', [iface, `(${s}) and (${around})`]);
      soft('show', ['sticks', `byres ${iface}`]);
      soft('show', ['nb_spheres', iface]);
      drop(iface);
    }
    drop(s);
  };

  /* ------------------------------ classified ---------------------------- */

  const classified = (selection: string): void => {
    const s = prepare(selection);
    soft('as', ['cartoon', `polymer & ${s}`]);
    soft('as', ['sticks', `organic & ${s}`]); // `organic` keyword unported → no-op
    soft('as', ['spheres', `inorganic & ${s}`]); // `inorganic` keyword unported → no-op
    drop(s);
  };

  /* ----------------------------- registration --------------------------- */

  /** Each entry maps a `preset.*` verb to a `(selection) => void` orchestrator. */
  const PRESETS: ReadonlyArray<readonly [string, (selection: string) => void]> = [
    ['simple', simple],
    ['simple_no_solv', simpleNoSolv],
    ['ligands', ligands],
    ['ligand_cartoon', ligandCartoon],
    ['ligand_sites', (sel) => drop(ligandSites(sel))],
    [
      'ligand_sites_hq',
      (sel) =>
        ligandSitesVariant(
          sel,
          [
            ['surface_quality', 1],
            ['surface_type', 0],
          ],
          false,
        ),
    ],
    [
      'ligand_sites_trans',
      (sel) =>
        ligandSitesVariant(
          sel,
          [
            ['transparency', 0.33],
            ['surface_type', 0],
            ['surface_quality', 0],
          ],
          true,
        ),
    ],
    [
      'ligand_sites_trans_hq',
      (sel) =>
        ligandSitesVariant(
          sel,
          [
            ['transparency', 0.33],
            ['surface_type', 0],
            ['surface_quality', 1],
          ],
          true,
        ),
    ],
    [
      'ligand_sites_mesh',
      (sel) =>
        ligandSitesVariant(
          sel,
          [
            ['surface_type', 2],
            ['surface_quality', 0],
          ],
          true,
        ),
    ],
    [
      'ligand_sites_dots',
      (sel) =>
        ligandSitesVariant(
          sel,
          [
            ['surface_type', 1],
            ['surface_quality', 1],
          ],
          true,
        ),
    ],
    ['ball_and_stick', ballAndStick],
    ['b_factor_putty', bFactorPutty],
    ['technical', technical],
    ['pretty', (sel) => pretty(sel, false)],
    ['pretty_solv', (sel) => pretty(sel, true)],
    ['pretty_no_solv', (sel) => pretty(sel, false)], // alias `pretty_no_solv = pretty`
    ['publication', (sel) => publication(sel, false)],
    ['pub_solv', (sel) => publication(sel, true)],
    ['pub_no_solv', (sel) => publication(sel, false)], // alias `pub_no_solv = publication`
    ['default', defaultPreset],
    ['interface', interfacePreset],
    ['classified', classified],
  ];

  for (const [name, fn] of PRESETS) {
    ctx.command(`preset.${name}`, (args): Json => {
      fn(str(args[0], 'all') || 'all');
      ctx.publish();
      return null;
    });
  }
}
