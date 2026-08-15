/**
 * The `analysis` command subsystem. Registers its `cmd.*` handlers via the
 * {@link RegistrarCtx}. See docs/engine-port-gaps.md.
 *
 * Ports the per-atom/per-object query surface of PyMOL's executive:
 *
 *   dss           — assign secondary structure ('H'/'S'/'') from backbone geometry
 *   get_chains    — the sorted distinct chain identifiers of a selection
 *   count_states  — the max number of coordinate states across matched objects
 *   identify      — the atom IDs (or (object, id) pairs) of a selection
 *   iterate       — run an expression per matched atom (read-only + `stored`)
 *   iterate_state — as `iterate`, with per-atom coordinates x/y/z in scope
 *   alter         — as `iterate`, but assigned atom fields are written back
 *
 * NOTE: unlike real PyMOL, the `iterate`/`alter` expression is **JavaScript**,
 * not Python. The atom's fields (name, resn, resi, resv, chain, segi, alt, elem,
 * b, q, color, ss, id, index, hetatm, model) are in scope as bare variables, plus
 * a mutable `stored` object for collecting side effects (supply it via the
 * `space.stored` kwarg, PyMOL-style). For `alter`, a statement like `b=42` or
 * `ss='H'` reassigns the in-scope variable and the new value is written back to
 * the atom. `iterate_state`/`alter_state` additionally expose x/y/z.
 */
import type { Json } from '@tenmol/protocol';
import { assignSecondaryStructure } from '../model/secondary-structure';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ iterate / alter -------------------------- */

/** Atom fields exposed as bare variables and (for `alter`) written back. */
const ATOM_FIELDS = [
  'name',
  'resn',
  'resi',
  'resv',
  'chain',
  'segi',
  'alt',
  'elem',
  'b',
  'q',
  'color',
  'ss',
  'id',
] as const;

/** Fields that must be coerced to a number when written back by `alter`. */
const NUMERIC_FIELDS = new Set(['resv', 'b', 'q', 'color', 'id']);

/**
 * Compile an `iterate`/`alter` expression into a function that, given an atom's
 * field values, evaluates the JS body (mutating `stored`) and returns the
 * possibly-reassigned atom-field values in `ATOM_FIELDS` order.
 */
function compileExpr(expr: string, extraParams: string[]): (...a: unknown[]) => unknown[] {
  // `formal_charge`/`partial_charge` use PyMOL's snake_case names in the body but
  // map to the camelCase AtomInfo keys on write-back (see runPerAtom).
  const params = [
    ...ATOM_FIELDS, 'index', 'hetatm', 'model',
    'formal_charge', 'partial_charge', 'p', ...extraParams, 'stored',
  ];
  const body = `${expr}\n;return [${ATOM_FIELDS.join(',')},formal_charge,partial_charge];`;

  const fn = new Function(...params, body) as (...a: unknown[]) => unknown[];
  return fn;
}

/** Resolve the caller's `stored` namespace object (PyMOL's `space`). */
function resolveStored(kwargs: Record<string, unknown>): Record<string, unknown> {
  const space = kwargs.space as Record<string, unknown> | undefined;
  if (space && typeof space.stored === 'object' && space.stored) {
    return space.stored as Record<string, unknown>;
  }
  if (kwargs.stored && typeof kwargs.stored === 'object') {
    return kwargs.stored as Record<string, unknown>;
  }
  return {};
}

/* -------------------------------- registrar ------------------------------ */

export function registerAnalysis(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const sel0 = (v: unknown): string => ctx.str(v, 'all') || 'all';

  // ---- get_chains --------------------------------------------------------
  ctx.command('get_chains', (args) => {
    const chains = new Set<string>();
    for (const ua of ex.atomsMatching(sel0(args[0]))) chains.add(ua.atom.chain);
    return [...chains].sort() as Json;
  });

  // ---- count_states ------------------------------------------------------
  ctx.command('count_states', (args) => {
    const names = new Set<string>();
    for (const ua of ex.atomsMatching(sel0(args[0]))) names.add(ua.objName);
    let max = 0;
    for (const n of names) max = Math.max(max, ex.molecule(n)?.nstate ?? 0);
    return max || 1;
  });

  // ---- identify ----------------------------------------------------------
  ctx.command('identify', (args, kwargs) => {
    const mode = Number(args[1] ?? kwargs.mode ?? 0) || 0;
    const out: Json[] = [];
    for (const ua of ex.atomsMatching(sel0(args[0]))) {
      out.push(mode === 1 ? [ua.objName, ua.atom.id] : ua.atom.id);
    }
    return out;
  });

  // ---- dss ---------------------------------------------------------------
  ctx.command('dss', (args, kwargs) => {
    const sel = sel0(args[0]);
    const state = Number(args[1] ?? kwargs.state ?? 0) || 0;
    const preserve = Number(args[3] ?? kwargs.preserve ?? 0) !== 0;
    // Per object, the target Cα atoms are those in the selection; H-bond context
    // is the whole object. Mirrors SelectorAssignSS (single-object path).
    const targets = new Map<string, Set<number>>();
    for (const ua of ex.atomsMatching(sel)) {
      let set = targets.get(ua.objName);
      if (!set) {
        set = new Set<number>();
        targets.set(ua.objName, set);
      }
      set.add(ua.index);
    }
    for (const [name, set] of targets) {
      const mol = ex.molecule(name);
      if (!mol) continue;
      // state 0 => all states (consensus); otherwise the single 1-based state.
      const states =
        state > 0 ? [state - 1] : Array.from({ length: Math.max(1, mol.nstate) }, (_, i) => i);
      assignSecondaryStructure(mol, states, preserve, (i) => set.has(i));
    }
    ctx.publish();
    return null;
  });

  // ---- iterate / iterate_state / alter -----------------------------------
  const runPerAtom = (
    sel: string,
    expr: string,
    kwargs: Record<string, unknown>,
    opts: { writeBack: boolean; state?: number },
  ): number => {
    const stored = resolveStored(kwargs);
    const withCoords = opts.state !== undefined;
    const fn = compileExpr(expr, withCoords ? ['x', 'y', 'z'] : []);
    const matched = ex.atomsMatching(sel);
    for (const ua of matched) {
      const a = ua.atom;
      const base: unknown[] = ATOM_FIELDS.map((f) => a[f]);
      base.push(ua.index + 1, a.hetatm, ua.objName);
      base.push(a.formalCharge ?? 0, a.partialCharge ?? 0);
      // `p` — the atom's custom-property namespace (set via set_atom_property).
      // For `alter` we hand over the live store so `p.foo = ...` persists; for
      // read-only `iterate` an empty stand-in when the atom has none.
      base.push(opts.writeBack ? (a.properties ??= {}) : a.properties ?? {});
      if (withCoords) {
        const mol = ex.molecule(ua.objName)!;
        const [x, y, z] = mol.coord(ua.index, opts.state && opts.state > 0 ? opts.state : 1);
        base.push(x, y, z);
      }
      base.push(stored);
      const result = fn(...base);
      if (opts.writeBack) {
        const prevResi = a.resi;
        const prevResv = a.resv;
        for (let k = 0; k < ATOM_FIELDS.length; k++) {
          const field = ATOM_FIELDS[k]!;
          const raw = result[k];
          const rec = a as unknown as Record<string, unknown>;
          if (NUMERIC_FIELDS.has(field)) {
            rec[field] = Number(raw);
          } else if (field === 'ss' || field === 'name' || field === 'resn' ||
                     field === 'resi' || field === 'chain' || field === 'segi' ||
                     field === 'alt' || field === 'elem') {
            rec[field] = String(raw);
          }
        }
        // `resi` and `resv` are two views of one property in PyMOL (P.cpp
        // ATOM_PROP_RESI/RESV): writing `resi` reparses `resv`+inscode, and
        // writing `resv` regenerates the `resi` text. Reconcile whichever one
        // the expression touched so canonical sorting (which keys on `resv`)
        // and range selections stay consistent. `resi` wins if both changed.
        if (a.resi !== prevResi) {
          a.resv = parseInt(a.resi, 10) || 0;
        } else if (a.resv !== prevResv) {
          a.resi = String(a.resv);
        }
        // Charges are appended after ATOM_FIELDS in the returned tuple; map the
        // snake_case body names back to the camelCase AtomInfo keys.
        const rec = a as unknown as Record<string, unknown>;
        rec.formalCharge = Number(result[ATOM_FIELDS.length]);
        rec.partialCharge = Number(result[ATOM_FIELDS.length + 1]);
      }
    }
    return matched.length;
  };

  ctx.command('iterate', (args, kwargs) =>
    runPerAtom(sel0(args[0]), ctx.str(args[1]), kwargs, { writeBack: false }),
  );

  ctx.command('iterate_state', (args, kwargs) => {
    const state = Number(args[0] ?? 1) || 1;
    return runPerAtom(sel0(args[1]), ctx.str(args[2]), kwargs, { writeBack: false, state });
  });

  ctx.command('alter', (args, kwargs) => {
    const n = runPerAtom(sel0(args[0]), ctx.str(args[1]), kwargs, { writeBack: true });
    ctx.publish();
    return n;
  });
}
