/**
 * The `dashes` command subsystem — `distance` / `angle` / `dihedral`, which
 * create measurement objects (rendered as dashes). The numeric `get_distance` /
 * `get_angle` / `get_dihedral` queries live in `measurement.ts`; these commands
 * additionally create a named, on-screen dashed object with the value labelled.
 */

import type { RegistrarCtx } from './registrar';
import { getColorIndex } from '../exec/color';
import {
  makeAngle,
  makeDihedral,
  makeDistance,
  type Vec3,
} from '../exec/measurement';

export function registerDashes(ctx: RegistrarCtx): void {
  const ex = ctx.executive;

  const coordsOf = (sel: string, state: number): Vec3[] => {
    const st = state > 0 ? state : 1;
    return ex.atomsMatching(sel).map((ua) => {
      const mol = ex.molecule(ua.objName)!;
      return mol.coord(ua.index, st) as Vec3;
    });
  };
  const one = (sel: string, state: number): Vec3 | null => {
    const c = coordsOf(sel, state);
    return c.length > 0 ? c[0]! : null;
  };
  const dashColor = (kw: Record<string, unknown>): number => {
    const name = kw.color;
    if (typeof name === 'string') {
      const idx = getColorIndex(name);
      if (idx >= 0) return idx;
    }
    return getColorIndex('yellow');
  };
  const num = (v: unknown, d: number): number => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };

  // Default name for an unlabelled measurement: PyMOL bumps the shared
  // `dist_counter` setting and formats `"%s%02.0f"` (querying.py distance/angle/
  // dihedral). distance -> dist01, angle -> angle01, dihedral -> dihedral01, all
  // drawing from the same counter.
  const nextMeasureName = (prefix: string): string => {
    const cnt = Math.trunc(ex.getSettingFloat('dist_counter')) + 1;
    ex.set('dist_counter', cnt);
    return `${prefix}${String(cnt).padStart(2, '0')}`;
  };

  // distance(name, selection1, selection2, cutoff=-1, mode=0, state=0, ...)
  ctx.command('distance', (args, kwargs) => {
    let name = ctx.str(kwargs.name ?? args[0]);
    if (name === '' || name === 'None') name = nextMeasureName('dist');
    const sel1 = ctx.str(kwargs.selection1 ?? args[1], 'pk1') || 'pk1';
    const sel2raw = ctx.str(kwargs.selection2 ?? args[2], 'pk2');
    const cutoff = num(kwargs.cutoff ?? args[3], -1);
    const state = num(kwargs.state ?? args[5], 0);
    const c1 = coordsOf(sel1, state);
    const c2 = sel2raw === '' ? c1 : coordsOf(sel2raw, state);
    const pairs: Array<[Vec3, Vec3]> = [];
    if (cutoff > 0) {
      for (const a of c1)
        for (const b of c2) {
          const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          if (d > 1e-6 && d <= cutoff) pairs.push([a, b]);
        }
    } else {
      // No cutoff: pair by matching index (the common "distance a, b" case).
      const n = Math.min(c1.length, c2.length);
      for (let i = 0; i < n; i++) pairs.push([c1[i]!, c2[i]!]);
    }
    const m = makeDistance(name, pairs, dashColor(kwargs));
    ex.addMeasurement(m);
    ctx.publish();
    return m.value;
  });

  // angle(name, s1, s2, s3, state=0, ...)
  ctx.command('angle', (args, kwargs) => {
    let name = ctx.str(kwargs.name ?? args[0]);
    if (name === '' || name === 'None') name = nextMeasureName('angle');
    const state = num(kwargs.state ?? args[4], 0);
    const a = one(ctx.str(kwargs.selection1 ?? args[1], 'pk1'), state);
    const b = one(ctx.str(kwargs.selection2 ?? args[2], 'pk2'), state);
    const c = one(ctx.str(kwargs.selection3 ?? args[3], 'pk3'), state);
    if (!a || !b || !c) return null;
    const m = makeAngle(name, a, b, c, dashColor(kwargs));
    ex.addMeasurement(m);
    ctx.publish();
    return m.value;
  });

  // dihedral(name, s1, s2, s3, s4, state=0, ...)
  ctx.command('dihedral', (args, kwargs) => {
    let name = ctx.str(kwargs.name ?? args[0]);
    if (name === '' || name === 'None') name = nextMeasureName('dihedral');
    const state = num(kwargs.state ?? args[5], 0);
    const a = one(ctx.str(kwargs.selection1 ?? args[1], 'pk1'), state);
    const b = one(ctx.str(kwargs.selection2 ?? args[2], 'pk2'), state);
    const c = one(ctx.str(kwargs.selection3 ?? args[3], 'pk3'), state);
    const d = one(ctx.str(kwargs.selection4 ?? args[4], 'pk4'), state);
    if (!a || !b || !c || !d) return null;
    const m = makeDihedral(name, a, b, c, d, dashColor(kwargs));
    ex.addMeasurement(m);
    ctx.publish();
    return m.value;
  });

  // auto_measure() — inspect the current pk1..pk4 picks and create the matching
  // distance / angle / dihedral, then clear the picks (querying.py:27).
  ctx.command('auto_measure', () => {
    const sels = new Set(ex.selectionNames());
    if (sels.has('pk1') && sels.has('pk2')) {
      if (sels.has('pk3')) {
        if (sels.has('pk4')) ctx.call('dihedral', []);
        else ctx.call('angle', []);
      } else {
        ctx.call('distance', []);
      }
    }
    ctx.call('unpick', []);
    return null;
  });
}
