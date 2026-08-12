/**
 * A per-story session that answers the Compute panel's `pymol.util` calls with
 * the numbers a live engine would return, so the panel shows real RESULTS next
 * to each helper instead of the empty result column the bare stub draws.
 *
 * WHY THE PANEL IS HOLLOW ON THE STUB. `ComputePanel` runs nothing on mount —
 * every result cell is filled only when its button is pressed, and each press
 * calls `session.call(m.fn, …)`. The global `withSession` decorator answers every
 * call with `null`, so a pressed helper reports `—` (or, for the SASA table, an
 * empty "no residues" shell). Nothing about the panel's real value — the numbers,
 * the per-residue exposure bars, the "done" side-effects — is visible.
 *
 * WHAT THIS SUPPLIES. The exact return shapes each helper produces:
 *   - the scalar helpers (`get_area`, `get_sasa`, `compute_mass`, the two charge
 *     sums) return plausible numbers for a mid-sized protein;
 *   - the two `find_surface_*` helpers return the name of the selection they made;
 *   - `phipsi` returns a `(phi, psi)` pair;
 *   - the `label_*` / side-effect helpers return `None`, which the panel reports
 *     as "done";
 *   - the SASA shim (`cmd.tenmol_compute.sasa_relative`) returns a real
 *     per-residue table — ten residues across two chains, one left un-normalised
 *     so the raw-value warning path is exercised — after answering the
 *     `…hello` install probe so the bootstrap round-trip is skipped.
 *
 * The story then drives a handful of these buttons from a mount effect (see
 * Compute.stories.tsx) so the panel paints POPULATED without any user click.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** `cmd.tenmol_compute` from `@tenmol/protocol/topics/compute`, inlined so this
 * helper needs no protocol dependency (the stories dir resolves only `@web` and
 * `@tenmol/stores`). */
const COMPUTE_NS = 'cmd.tenmol_compute';

/**
 * Ten residues of relative SASA across two chains, `[value, r, g, b]`-free — the
 * shape `cmd.tenmol_compute.sasa_relative` returns. Values are 0 (buried) … 1
 * (exposed); the last residue is left un-normalised so the panel's raw-value
 * warning colour is shown.
 */
const SASA_RECORDS = [
  { chain: 'A', resi: '12', resn: 'LEU', value: 0.82, normalised: true },
  { chain: 'A', resi: '34', resn: 'GLU', value: 0.61, normalised: true },
  { chain: 'A', resi: '56', resn: 'LYS', value: 0.94, normalised: true },
  { chain: 'A', resi: '78', resn: 'PHE', value: 0.18, normalised: true },
  { chain: 'A', resi: '101', resn: 'ARG', value: 0.73, normalised: true },
  { chain: 'B', resi: '12', resn: 'SER', value: 0.44, normalised: true },
  { chain: 'B', resi: '45', resn: 'TYR', value: 0.09, normalised: true },
  { chain: 'B', resi: '88', resn: 'ASP', value: 0.67, normalised: true },
  { chain: 'B', resi: '120', resn: 'GLY', value: 0.5, normalised: true },
  { chain: 'B', resi: '152', resn: 'VAL', value: 41.3, normalised: false },
].map((r) => ({
  ...r,
  // `/model/segi/chain/`resi` — PyMOL's own spelling, and a usable selection.
  sele: `/1oki//${r.chain}/\`${r.resi}`,
  model: '1oki',
  segi: '',
}));

const SASA_RESULT = {
  ok: true,
  var: 'b',
  records: SASA_RECORDS,
  unnormalised: 1,
};

/** Answer one compute call the way a live engine would. */
function computeCall(fn: string): unknown {
  switch (fn) {
    case 'util.get_area':
      return 12873.45;
    case 'util.get_sasa':
      return 9421.88;
    case 'util.compute_mass':
      return 25843.62;
    case 'util.sum_formal_charges':
      return -4;
    case 'util.sum_partial_charges':
      return -0.0187;
    case 'util.find_surface_residues':
      return 'exposed_res';
    case 'util.find_surface_atoms':
      return 'exposed_atoms';
    case 'util.phipsi':
      return [-63.2, -41.8];

    // The SASA shim: answer the install probe truthily (so the panel skips the
    // one-line bootstrap), then return the per-residue table.
    case `${COMPUTE_NS}.hello`:
      return { ok: true, attr: 'tenmol_compute', methods: ['sasa_relative'] };
    case `${COMPUTE_NS}.sasa_relative`:
      return SASA_RESULT;

    // Everything else (label_chains, label_segments, b2vdw, …) runs for its side
    // effect and returns None — the panel reports that as "done".
    default:
      return null;
  }
}

/** Wrap a story in a session that answers the compute helpers with real values. */
export const withComputeData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string) => Promise.resolve(computeCall(fn))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
