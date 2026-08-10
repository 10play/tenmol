import { describe, it, expect } from 'vitest';
import { Executive } from '../src/exec/executive';
import { parsePdb } from '../src/model/pdb';
import { Rep } from '@tenmol/protocol';
import { registerDisplay } from '../src/cmd/display';
import { getColorIndex, getColorTuple } from '../src/exec/color';
import type { CommandHandler, RegistrarCtx } from '../src/cmd/registrar';

/* ------------------------------------------------------------------------ */
/* Fixed-column PDB fixture: 3 atoms, one chain, distinct elements.          */
/* ------------------------------------------------------------------------ */

function pad(v: string | number, width: number, right = true): string {
  const s = String(v);
  return right ? s.padStart(width) : s.padEnd(width);
}

/** Emit one ATOM record in the PyMOL/PDB fixed-column layout. */
function atomLine(
  serial: number,
  name: string,
  resn: string,
  chain: string,
  resi: number,
  x: number,
  y: number,
  z: number,
  elem: string,
): string {
  const namePadded =
    name.length >= 4 ? name.slice(0, 4) : ' ' + name.padEnd(3);
  return (
    'ATOM  ' + // 1-6
    pad(serial, 5) + // 7-11
    ' ' + // 12
    namePadded + // 13-16
    ' ' + // 17 altLoc
    pad(resn, 3) + // 18-20
    ' ' + // 21
    chain + // 22
    pad(resi, 4) + // 23-26
    ' ' + // 27 iCode
    '   ' + // 28-30
    pad(x.toFixed(3), 8) + // 31-38
    pad(y.toFixed(3), 8) + // 39-46
    pad(z.toFixed(3), 8) + // 47-54
    pad('1.00', 6) + // 55-60 occupancy
    pad('0.00', 6) + // 61-66 tempFactor
    '          ' + // 67-76
    pad(elem, 2) // 77-78 element
  );
}

const PDB = [
  atomLine(1, 'N', 'GLY', 'A', 1, 0, 0, 0, 'N'),
  atomLine(2, 'CA', 'GLY', 'A', 1, 1.458, 0, 0, 'C'),
  atomLine(3, 'O', 'GLY', 'A', 1, 2.0, 1.0, 0, 'O'),
  'END',
].join('\n');

/** Fresh executive + registered display handlers. */
function setup(): {
  ex: Executive;
  handlers: Map<string, CommandHandler>;
  call: (name: string, args?: unknown[], kwargs?: Record<string, unknown>) => unknown;
} {
  const ex = new Executive();
  ex.addMolecule(parsePdb(PDB, 'm'));
  const handlers = new Map<string, CommandHandler>();
  let publishes = 0;
  const ctx: RegistrarCtx = {
    command: (n, f) => handlers.set(n, f),
    executive: ex,
    publish: () => {
      publishes++;
    },
    emitView: () => {},
    str: (v, d = '') => (v == null ? d : String(v)),
  };
  registerDisplay(ctx);
  void publishes;
  const call = (name: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
    handlers.get(name)!(args, kwargs);
  return { ex, handlers, call };
}

/* ------------------------------------------------------------------------ */

describe('display: fixture sanity', () => {
  it('parses three atoms', () => {
    const { ex } = setup();
    expect(ex.molecule('m')!.natom).toBe(3);
  });
});

describe('set_object_color / get_object_color', () => {
  it('stores the object colour index and reads it back', () => {
    const { call } = setup();
    expect(call('set_object_color', ['m', 'green'])).toBe(getColorIndex('green'));
    expect(call('get_object_color', ['m'])).toBe(getColorIndex('green'));
  });

  it('returns -1 for an unknown colour or object', () => {
    const { call } = setup();
    expect(call('set_object_color', ['m', 'not_a_color'])).toBe(-1);
    expect(call('set_object_color', ['nope', 'green'])).toBe(-1);
    expect(call('get_object_color', ['nope'])).toBe(-1);
  });
});

describe('color_deep', () => {
  it('recolours every atom AND the object colour', () => {
    const { ex, call } = setup();
    const n = call('color_deep', ['blue', 'all']);
    expect(n).toBe(3);
    // Every atom now selects as `color blue`.
    expect(ex.countAtoms('color blue')).toBe(3);
    // Object colour tracks too.
    expect(call('get_object_color', ['m'])).toBe(getColorIndex('blue'));
  });

  it('honours a sub-selection', () => {
    const { ex, call } = setup();
    call('color_deep', ['red', 'elem N']);
    expect(ex.countAtoms('color red')).toBe(1);
    expect(ex.countAtoms('color blue')).toBe(0);
  });

  it('returns 0 for an unknown colour', () => {
    const { call } = setup();
    expect(call('color_deep', ['bogus', 'all'])).toBe(0);
  });
});

describe('recolor / rebuild', () => {
  it('are no-ops returning null', () => {
    const { call } = setup();
    expect(call('recolor', ['all'])).toBeNull();
    expect(call('rebuild', ['all'])).toBeNull();
  });
});

describe('get_color_indices', () => {
  it('contains known palette entries with their indices', () => {
    const { call } = setup();
    const pairs = call('get_color_indices', [0]) as Array<[string, number]>;
    const map = new Map(pairs);
    expect(map.get('white')).toBe(0);
    expect(map.get('black')).toBe(1);
    expect(map.get('red')).toBe(4);
    expect(map.get('yellow')).toBe(6);
    // Every returned pair's index must round-trip through getColorIndex.
    for (const [name, idx] of pairs) expect(getColorIndex(name)).toBe(idx);
  });
});

describe('space / get_color_space', () => {
  it('tracks the colour-space setting', () => {
    const { ex, call } = setup();
    expect(call('space', ['cmyk'])).toBeNull();
    expect(ex.getSetting('color_space')).toBe('cmyk');
    expect(call('get_color_space', [])).toBe('cmyk');
    // Default when never set.
    const fresh = setup();
    expect(fresh.call('get_color_space', [])).toBe('rgb');
  });
});

describe('desaturate', () => {
  it('moves a pure-red atom halfway toward grey', () => {
    const { ex, call } = setup();
    ex.color('red', 'all'); // index 4 -> [1,0,0]
    const n = call('desaturate', ['all', 0.5]);
    expect(n).toBe(3);
    // New colour = red*0.5 + grey(0.5)*0.5 = [0.75, 0.25, 0.25].
    const idx = ex.molecule('m')!.atoms[0]!.color;
    expect(idx).not.toBe(getColorIndex('red'));
    const rgb = getColorTuple(idx)!;
    expect(rgb[0]).toBeCloseTo(0.75, 6);
    expect(rgb[1]).toBeCloseTo(0.25, 6);
    expect(rgb[2]).toBeCloseTo(0.25, 6);
  });

  it('shares one new colour slot for atoms of the same source colour', () => {
    const { ex, call } = setup();
    ex.color('red', 'all');
    call('desaturate', ['all', 0.25]);
    const colors = ex.molecule('m')!.atoms.map((a) => a.color);
    expect(new Set(colors).size).toBe(1); // all were red -> one shared slot
  });

  it('factor 0 leaves the colour visually unchanged', () => {
    const { ex, call } = setup();
    ex.color('blue', 'all'); // [0,0,1]
    call('desaturate', ['all', 0]);
    const rgb = getColorTuple(ex.molecule('m')!.atoms[0]!.color)!;
    expect(rgb[0]).toBeCloseTo(0, 6);
    expect(rgb[1]).toBeCloseTo(0, 6);
    expect(rgb[2]).toBeCloseTo(1, 6);
  });
});

describe('label', () => {
  it('sets the labels rep bit and stores evaluated text', () => {
    const { ex, call } = setup();
    const bit = 1 << Rep.Label;
    const n = call('label', ['all', 'resn']);
    expect(n).toBe(3);
    for (const a of ex.molecule('m')!.atoms) {
      expect(a.visRep & bit).toBe(bit);
    }
    const labels = call('get_label', ['all']) as Array<[string, number, string]>;
    expect(labels.length).toBe(3);
    // resn expression -> 'GLY' for every atom.
    expect(labels.every(([, , t]) => t === 'GLY')).toBe(true);
  });

  it('evaluates a JS expression over atom fields', () => {
    const { call } = setup();
    call('label', ['all', 'resn + "/" + name']);
    const labels = call('get_label', ['elem C']) as Array<[string, number, string]>;
    expect(labels).toEqual([['m', 2, 'GLY/CA']]);
  });

  it('treats a quoted literal verbatim', () => {
    const { call } = setup();
    call('label', ['elem O', '"hi"']);
    const labels = call('get_label', ['elem O']) as Array<[string, number, string]>;
    expect(labels).toEqual([['m', 3, 'hi']]);
  });

  it('an empty expression clears the label and the bit', () => {
    const { ex, call } = setup();
    const bit = 1 << Rep.Label;
    call('label', ['all', 'resn']);
    call('label', ['all', '']);
    expect(call('get_label', ['all'])).toEqual([]);
    for (const a of ex.molecule('m')!.atoms) expect(a.visRep & bit).toBe(0);
  });
});

describe('cartoon / get_cartoon', () => {
  it('maps type names to cartoon_type ints and stores per object', () => {
    const { ex, call } = setup();
    expect(call('cartoon', ['tube', 'all'])).toBe(4);
    expect(ex.getSetting('cartoon_type')).toBe(4);
    expect(call('get_cartoon', ['m'])).toBe(4);
  });

  it('supports the documented subtypes', () => {
    const { call } = setup();
    expect(call('cartoon', ['automatic', 'all'])).toBe(0);
    expect(call('cartoon', ['loop', 'all'])).toBe(1);
    expect(call('cartoon', ['rect', 'all'])).toBe(2);
    expect(call('cartoon', ['oval', 'all'])).toBe(3);
    expect(call('cartoon', ['arrow', 'all'])).toBe(5);
    expect(call('cartoon', ['skip', 'all'])).toBe(-1);
  });

  it('unknown type falls back to automatic (0)', () => {
    const { call } = setup();
    expect(call('cartoon', ['wobble', 'all'])).toBe(0);
  });
});

describe('set_vis', () => {
  it('accepts a snapshot dict and returns null', () => {
    const { call } = setup();
    expect(call('set_vis', [{ m: [] }])).toBeNull();
  });
});
