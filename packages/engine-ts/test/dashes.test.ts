import { describe, it, expect } from 'vitest';
import { decodeGeometryFrame, Rep, isCgoDrawArraysHeader } from '@tenmol/protocol';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { registerDashes } from '../src/cmd/dashes';
import { buildMeasurementFrame } from '../src/exec/measurement';
import type { CommandHandler } from '../src/cmd/registrar';

// Two atoms 3 Å apart on x; a third to make an angle/dihedral.
function line(serial: number, name: string, x: number, y: number, z: number): string {
  const b = ' '.repeat(80).split('');
  const put = (s: number, t: string) => { for (let i = 0; i < t.length; i++) b[s - 1 + i] = t[i]!; };
  put(1, 'ATOM'); put(7, String(serial).padStart(5)); put(14, name); put(18, 'ALA'); put(22, 'A');
  put(23, '   1'); put(31, x.toFixed(3).padStart(8)); put(39, y.toFixed(3).padStart(8));
  put(47, z.toFixed(3).padStart(8)); put(55, '1.00'); put(61, '0.00'); put(77, name[0]!.padStart(2));
  return b.join('').replace(/\s+$/, '');
}
const PDB = [
  line(1, 'N', 0, 0, 0),
  line(2, 'CA', 3, 0, 0),
  line(3, 'C', 3, 4, 0),
  line(4, 'O', 6, 4, 0),
].join('\n') + '\nEND\n';

function setup() {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const h = new Map<string, CommandHandler>();
  let publishes = 0;
  registerDashes({
    command: (n, f) => h.set(n, f),
    executive: ex,
    publish() { publishes++; },
    emitView() {},
    str: (v, d = '') => (v == null ? d : String(v)),
  });
  return { ex, call: (n: string, a: unknown[]) => h.get(n)!(a, {}), pub: () => publishes };
}

describe('dashes: distance / angle / dihedral measurement objects', () => {
  it('distance creates a measured, renderable dash object', () => {
    const t = setup();
    const d = t.call('distance', ['d1', 'name N', 'name CA']) as number;
    expect(d).toBeCloseTo(3.0, 4);
    const m = t.ex.measurement('d1')!;
    expect(m.kind).toBe('distance');
    // The one 3.0 Å pair renders as PyMOL-style GAPPED dashes (DASH_LENGTH 0.1 +
    // DASH_GAP 0.4 → 0.5 Å period → 6 dash segments), not a single solid line.
    expect(m.segments.length).toBe(6);
    expect(t.ex.getNames('objects')).toContain('d1');
    // renders as a dash line frame — one line instance per dash segment
    const buf = buildMeasurementFrame(m, 0)!;
    const f = decodeGeometryFrame(buf);
    expect(f.header.rep).toBe(Rep.Dash);
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.kind).toBe('line');
    expect(isCgoDrawArraysHeader(f.header) && f.header.instances[0]!.count).toBe(6);
    expect(t.pub()).toBe(1);
  });

  it('angle measures the vertex angle', () => {
    const t = setup();
    // N(0,0,0)-CA(3,0,0)-C(3,4,0): angle at CA is 90 degrees
    const a = t.call('angle', ['a1', 'name N', 'name CA', 'name C']) as number;
    expect(a).toBeCloseTo(90, 3);
    expect(t.ex.measurement('a1')!.segments.length).toBeGreaterThan(2); // arms + arc
  });

  it('dihedral measures the signed torsion', () => {
    const t = setup();
    // N-CA-C-O all in z=0 plane -> dihedral 0 or 180
    const dih = t.call('dihedral', ['t1', 'name N', 'name CA', 'name C', 'name O']) as number;
    expect(Math.abs(Math.abs(dih) - 180) < 1e-3 || Math.abs(dih) < 1e-3).toBe(true);
    expect(t.ex.measurement('t1')!.kind).toBe('dihedral');
  });

  it('delete removes a measurement object', () => {
    const t = setup();
    t.call('distance', ['d1', 'name N', 'name CA']);
    t.ex.delete('d1');
    expect(t.ex.measurement('d1')).toBeUndefined();
    expect(t.ex.getNames('objects')).not.toContain('d1');
  });
});
