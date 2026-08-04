/**
 * Wire types for `cmd.tenmol_compute` (`packages/bridge/tenmol_bridge/panels/compute.py`).
 *
 * Only one `pymol.util` helper needs a bridge module at all. The rest —
 * `get_area`, `compute_mass`, `label_chains`, `phipsi` and the others — are
 * called directly as `util.<name>`, because `util` is in the policy's
 * `DEFAULT_ROOTS` and their arguments and return values are already JSON.
 *
 * `get_sasa_relative` is the exception: it returns a dict keyed by a 4-tuple,
 * which the codec refuses with `NotSerializable: dict key of type tuple`. The
 * re-keying is done in Python (see that module's docstring for why there and
 * not here), and this file is the shape it produces.
 *
 * Installation follows `topics/files.ts`: the module attaches itself to
 * `pymol.cmd`, and the client bootstraps it with one `{t:'do'}` line, so
 * neither `server.py` nor a policy grant nor a frozen barrel is touched.
 *
 * @notATopic  NOT A TRANSPORT TOPIC — deliberately not re-exported by the
 * frozen `topics/index.ts` barrel. Reached by its subpath
 * (`@tenmol/protocol/topics/compute`); it is a request/reply surface only and
 * publishes no events. `packages/bridge/tests/test_dispatch.py` looks for this tag.
 */

/** Dotted prefix for every call in this area. */
export const COMPUTE_NS = 'cmd.tenmol_compute' as const;

/** The one-line Python the client sends as `{t:'do'}` to install the service. */
export const COMPUTE_BOOTSTRAP =
  'import tenmol_bridge.panels.compute as _tc; _tc.install()';

export interface ComputeHello {
  ok: boolean;
  attr: string;
  methods: string[];
}

/** One residue of `util.get_sasa_relative`, with the tuple key spelled out. */
export interface SasaRecord {
  /**
   * `/model/segi/chain/\`resi` — PyMOL's own spelling, and a valid selection
   * expression, so it can be handed straight to `select`, `zoom` or `iterate`.
   */
  sele: string;
  model: string;
  segi: string;
  chain: string;
  /** A STRING: `resi` may carry an insertion code, e.g. `"52A"`. */
  resi: string;
  /** Empty when the residue has no guide atom to read it from. */
  resn: string;
  /** 0 = buried, 1 = fully exposed — unless `normalised` is false. */
  value: number;
  /** See the Python module: upstream skips normalising some residues. */
  normalised: boolean;
}

export interface SasaRelativeResult {
  ok: boolean;
  /** The atom property the values were also `alter`ed onto (default `b`). */
  var: string;
  records: SasaRecord[];
  /** How many records have `normalised: false`. */
  unnormalised: number;
}
