/**
 * "Is APBS actually usable on this machine?", asked rather than assumed.
 *
 * The parity row for the APBS dialog (`00-parity-inventory.md`, the
 * "5 stacked pages, 86 widgets" row) defers the port with the argument that
 * neither `apbs` nor `pdb2pqr` ships with PyMOL and neither is installed here.
 * A panel that only *asserts* that in prose is unfalsifiable and goes stale the
 * day someone installs them, so the panel measures it instead — through
 * `subproc.which`, granted by `bridge/tenmol_bridge/policy/grants/wp-25-apbs.py`.
 *
 * The candidate lists below are NOT invented: they are exactly what the Qt
 * plugin looks for, so a "found" here means the plugin would find the same
 * file.
 *
 *   apbs      `shutil.which('apbs')`, else `$SCHRODINGER/utilities/apbs`
 *             — `data/startup/apbs_gui/electrostatics.py:49-57`
 *   pdb2pqr   `pdb2pqr`, `pdb2pqr30`, `pdb2pqr_cli` in that order
 *             — `data/startup/apbs_gui/__init__.py:224-231`
 *
 * One deliberate difference, stated because it is a behaviour change and not
 * an oversight: the plugin's `$SCHRODINGER` branch uses `os.path.exists`, while
 * `subproc.which` additionally requires the execute bit. A non-executable file
 * at that path is reported as missing here and as present by the plugin — and
 * the plugin's next step, `subprocess.call([exe, '--version'])`, would fail.
 */

/** The subset of `Session` this module needs, so tests need no socket. */
export type CallFn = <T>(
  fn: string,
  args?: readonly unknown[],
  kwargs?: Readonly<Record<string, unknown>>,
) => Promise<T>;

export const APBS_CANDIDATES = ['apbs', '$SCHRODINGER/utilities/apbs'] as const;
export const PDB2PQR_CANDIDATES = ['pdb2pqr', 'pdb2pqr30', 'pdb2pqr_cli'] as const;

export interface ProgramStatus {
  /** What the plugin would call it. */
  name: string;
  /** Absolute path, or `null` when nothing on the candidate list resolved. */
  path: string | null;
  /** Every name tried, in the plugin's own order. */
  tried: readonly string[];
}

export interface ApbsProbe {
  apbs: ProgramStatus;
  pdb2pqr: ProgramStatus;
  /** True when the plugin's own `findPlugins` scan sees `apbs_gui`. */
  pluginOnStartupPath: boolean;
  /** Set when the probe itself failed (socket down, policy refusal, ...). */
  error: string | null;
}

/**
 * Resolve one candidate list to the first hit.
 *
 * `$`-prefixed candidates go through `cmd.exp_path` first, which is how PyMOL
 * expands `$SCHRODINGER` / `$PYMOL_DATA` everywhere else
 * (`modules/pymol/parsing.py`). When the variable is unset, `exp_path` returns
 * the string unchanged and `which` then answers `null` for it, which is the
 * correct answer.
 */
export async function firstProgram(
  call: CallFn,
  candidates: readonly string[],
): Promise<ProgramStatus> {
  const name = candidates[0] ?? '';
  for (const candidate of candidates) {
    const target = candidate.includes('$')
      ? await call<string>('cmd.exp_path', [candidate])
      : candidate;
    const path = await call<string | null>('subproc.which', [target]);
    if (path) return { name, path, tried: candidates };
  }
  return { name, path: null, tried: candidates };
}

const MISSING = (candidates: readonly string[]): ProgramStatus => ({
  name: candidates[0] ?? '',
  path: null,
  tried: candidates,
});

export const UNKNOWN_PROBE: ApbsProbe = {
  apbs: MISSING(APBS_CANDIDATES),
  pdb2pqr: MISSING(PDB2PQR_CANDIDATES),
  pluginOnStartupPath: false,
  error: null,
};

export async function probeApbs(call: CallFn): Promise<ApbsProbe> {
  try {
    const paths = await call<string[]>('plugins.get_startup_path');
    const found = await call<Record<string, string>>('plugins.findPlugins', [paths]);
    return {
      apbs: await firstProgram(call, APBS_CANDIDATES),
      pdb2pqr: await firstProgram(call, PDB2PQR_CANDIDATES),
      pluginOnStartupPath: Object.keys(found ?? {}).includes('apbs_gui'),
      error: null,
    };
  } catch (error) {
    return { ...UNKNOWN_PROBE, error: error instanceof Error ? error.message : String(error) };
  }
}

/** One short sentence per program, for the panel. */
export function describeProgram(status: ProgramStatus): string {
  return status.path === null
    ? `${status.name}: not found (tried ${status.tried.join(', ')})`
    : `${status.name}: ${status.path}`;
}

/** True when the full pipeline could actually run here. */
export function pipelineIsRunnable(probe: ApbsProbe): boolean {
  return probe.apbs.path !== null && probe.pdb2pqr.path !== null;
}
