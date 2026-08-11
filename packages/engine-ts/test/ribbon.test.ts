/**
 * Tests for the `ribbon` representation geometry builder (`geometry/ribbon.ts`).
 *
 * Isolated on purpose: it imports only the ribbon module, the PDB parser and the
 * protocol codec — NOT the full Engine/LocalBackend, whose other subsystems are
 * being edited concurrently.
 */

import { describe, it, expect } from 'vitest';
import { buildRibbonFrame } from '../src/geometry/ribbon';
import { parsePdb } from '../src/model/pdb';
import { repBit } from '../src/model/atom';
import type { ObjectMolecule } from '../src/model/molecule';
import {
  Rep,
  decodeGeometryFrame,
  geometryFrameProblems,
  viewOf,
  INSTANCE_ITEM_SIZE,
  itemCount,
  type CgoDrawArraysHeader,
} from '@tenmol/protocol';

/** PyMOL `ribbon_sampling` default = 1 → one straight segment per residue span. */
const RIBBON_SAMPLING = 1;

/** One right-column-correct ATOM record. */
function atomLine(
  serial: number,
  name: string,
  resi: number,
  chain: string,
  xyz: [number, number, number],
): string {
  const [x, y, z] = xyz;
  const f = (v: number): string => v.toFixed(3).padStart(8, ' ');
  return (
    'ATOM  ' +
    String(serial).padStart(5, ' ') +
    ' ' +
    name.padEnd(4, ' ') +
    ' ' + // altLoc
    'ALA' +
    ' ' +
    chain +
    String(resi).padStart(4, ' ') +
    '    ' + // iCode + 3 blanks
    f(x) +
    f(y) +
    f(z) +
    '  1.00  0.00' +
    '           C'
  );
}

/** A CA-only chain: `n` residues placed on a helix so the spline is non-degenerate. */
function caChainPdb(n: number, chain = 'A', serialBase = 0): string {
  const lines: string[] = [];
  for (let k = 0; k < n; k++) {
    const ang = k * 1.0;
    const x = 5 * Math.cos(ang);
    const y = 5 * Math.sin(ang);
    const z = 1.5 * k;
    lines.push(atomLine(serialBase + k + 1, 'CA', k + 1, chain, [x, y, z]));
  }
  return lines.join('\n') + '\n';
}

function showRibbon(mol: ObjectMolecule): void {
  const bit = repBit(Rep.Ribbon);
  for (const a of mol.atoms) a.visRep |= bit;
}

const CTX = (mol: ObjectMolecule) => ({
  mol,
  state: 1,
  seq: 7,
  getSettingFloat: () => 0,
});

describe('buildRibbonFrame', () => {
  it('returns null when no atom carries the ribbon rep', () => {
    const mol = parsePdb(caChainPdb(6), 'ca');
    // Default visRep is lines only — no ribbon bit set.
    expect(buildRibbonFrame(CTX(mol))).toBeNull();
  });

  it('emits one line instance buffer with one straight segment per span', () => {
    const n = 6;
    const mol = parsePdb(caChainPdb(n), 'ca');
    showRibbon(mol);

    const frame = buildRibbonFrame(CTX(mol));
    expect(frame).not.toBeNull();

    const { header } = decodeGeometryFrame(frame!);
    expect(header.kind).toBe('cgo-draw-arrays');
    const h = header as CgoDrawArraysHeader;

    // Exactly one instance buffer, of kind 'line'.
    expect(h.blocks).toEqual([]);
    expect(h.instances).toHaveLength(1);
    const inst = h.instances[0]!;
    expect(inst.kind).toBe('line');
    expect(inst.itemSize).toBe(INSTANCE_ITEM_SIZE.line);
    expect(h.rep).toBe(Rep.Ribbon);
    expect(h.seq).toBe(7);
    expect(h.object).toBe('ca');

    // (n-1) spans, each one straight segment at ribbon_sampling=1 → n-1 lines.
    const expected = (n - 1) * RIBBON_SAMPLING;
    expect(inst.count).toBe(expected);
    expect(itemCount(inst.data)).toBe(expected);

    // Frame is well-formed by the protocol's own checker.
    expect(geometryFrameProblems(h)).toEqual([]);
  });

  it('starts the trace exactly at the first Cα and colours by residue', () => {
    const mol = parsePdb(caChainPdb(4), 'ca');
    // Colour every CA red (index 4 in the palette) so the emitted rgba is known.
    for (const a of mol.atoms) a.color = 4; // red = [1,0,0]
    showRibbon(mol);

    const frame = buildRibbonFrame(CTX(mol))!;
    const decoded = decodeGeometryFrame(frame);
    const h = decoded.header as CgoDrawArraysHeader;
    const data = viewOf(decoded, h.instances[0]!.data) as Float32Array;

    // First line's first vertex is the spline at t=0 of the first span = the
    // first CA atom's coordinate exactly (float32-rounded).
    const [x0, y0, z0] = mol.coord(0, 1);
    expect(data[0]).toBeCloseTo(x0, 5);
    expect(data[1]).toBeCloseTo(y0, 5);
    expect(data[2]).toBeCloseTo(z0, 5);

    // rgba1 of the first instance is the residue colour (red, opaque).
    expect(data[6]).toBeCloseTo(1, 6);
    expect(data[7]).toBeCloseTo(0, 6);
    expect(data[8]).toBeCloseTo(0, 6);
    expect(data[9]).toBeCloseTo(1, 6);

    // Per-instance atom index is present, one per line, all valid atom ids.
    const atom = viewOf(decoded, h.instances[0]!.atom!) as Int32Array;
    expect(atom.length).toBe(h.instances[0]!.count);
    for (const id of atom) expect(id).toBeGreaterThanOrEqual(1);
  });

  it('traces each chain independently and skips single-guide chains', () => {
    // Chain A: 5 CA (traceable). Chain B: 1 CA (too short to trace).
    const pdb = caChainPdb(5, 'A', 0) + caChainPdb(1, 'B', 100);
    const mol = parsePdb(pdb, 'multi');
    showRibbon(mol);

    const h = decodeGeometryFrame(buildRibbonFrame(CTX(mol))!).header as CgoDrawArraysHeader;
    // Only chain A contributes: (5-1) straight segments; chain B's lone CA adds none.
    expect(h.instances[0]!.count).toBe((5 - 1) * RIBBON_SAMPLING);
    expect(geometryFrameProblems(h)).toEqual([]);
  });

  it('ignores non-guide atoms (only CA / P are traced)', () => {
    // A chain whose atoms are all ribbon-flagged but named CB (not a guide).
    const line = (s: number, r: number): string => atomLine(s, 'CB', r, 'A', [r * 1.0, 0, 0]);
    const mol = parsePdb(line(1, 1) + '\n' + line(2, 2) + '\n', 'nocb');
    showRibbon(mol);
    expect(buildRibbonFrame(CTX(mol))).toBeNull();
  });
});
