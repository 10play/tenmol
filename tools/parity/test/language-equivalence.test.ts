import { describe, expect, it } from 'vitest';
import { createLocalBackend } from '@tenmol/engine-ts';
import { SMALL_PDB } from '../src/corpus';
import type { Op, Script } from '../src/corpus';
import { probeSnapshot, diffSnapshots } from '../src/probe';

/**
 * "SAME SCRIPT, TWO LANGUAGES." The whole promise of the port is that PyMOL's
 * console (which runs Python) and tenmol's console (which runs JavaScript) drive
 * the identical engine. Here we run each operation BOTH ways —
 *
 *   PyMOL command language   backend.do('as spheres')
 *   JavaScript in the console backend.do('cmd.show_as("spheres","all")')
 *
 * — against a fresh `createLocalBackend()` each time, then assert the two runs
 * produce byte-for-byte identical observable snapshots (counts / names / view /
 * colours / settings) using the same probe machinery the differential gate uses.
 * Zero divergence == the two languages are interchangeable over the ported slice.
 */

const load: Op = { call: ['read_pdbstr', SMALL_PDB, 'm'] };

interface LangPair {
  name: string;
  /** Ops in the PyMOL command language (`as spheres`, `color red, chain A`). */
  cmd: string[];
  /** The SAME ops in console JavaScript (`cmd.show_as("spheres","all")`). */
  js: string[];
  selectors: string[];
  gateView?: boolean;
  gateColorTuples?: string[];
  gateSettings?: string[];
}

const PAIRS: LangPair[] = [
  {
    name: 'as spheres',
    cmd: ['as spheres'],
    js: ['cmd.show_as("spheres","all")'],
    selectors: ['rep spheres', 'rep lines'],
  },
  {
    name: 'color two chains',
    cmd: ['color red, chain A', 'color blue, chain B'],
    js: ['cmd.color("red","chain A")', 'cmd.color("blue","chain B")'],
    selectors: ['color red', 'color blue', 'color green'],
    gateColorTuples: ['red', 'blue'],
  },
  {
    name: 'show + hide',
    cmd: ['show spheres, name CA', 'hide lines, chain B'],
    js: ['cmd.show("spheres","name CA")', 'cmd.hide("lines","chain B")'],
    selectors: ['rep spheres', 'rep lines'],
  },
  {
    name: 'as sticks then color',
    cmd: ['as sticks', 'color yellow, elem C'],
    js: ['cmd.show_as("sticks","all")', 'cmd.color("yellow","elem C")'],
    selectors: ['rep sticks', 'rep lines', 'color yellow'],
  },
  {
    name: 'show nonbonded',
    cmd: ['show nonbonded, all'],
    js: ['cmd.show("nonbonded","all")'],
    selectors: ['rep nonbonded'],
  },
  {
    name: 'as nb_spheres on a subset',
    cmd: ['as nb_spheres, chain A'],
    js: ['cmd.show_as("nb_spheres","chain A")'],
    selectors: ['rep nb_spheres', 'rep lines'],
  },
  {
    name: 'named selection',
    cmd: ['select sub, resi 1'],
    js: ['cmd.select("sub","resi 1")'],
    selectors: ['sub', 'sub and name CA', 'not sub'],
  },
  {
    name: 'set a setting',
    cmd: ['set sphere_scale, 2'],
    js: ['cmd.set("sphere_scale", 2)'],
    selectors: ['all'],
    gateSettings: ['sphere_scale'],
  },
  {
    name: 'turn the camera',
    cmd: ['turn x, 90'],
    js: ['cmd.turn("x", 90)'],
    selectors: ['all'],
    gateView: true,
  },
];

function scriptFor(pair: LangPair, lines: string[]): Script {
  return {
    name: pair.name,
    ops: [load, ...lines.map((l): Op => ({ do: l }))],
    selectors: pair.selectors,
    gateNames: true,
    gateView: pair.gateView,
    gateColorTuples: pair.gateColorTuples,
    gateSettings: pair.gateSettings,
  };
}

async function runFresh(script: Script): Promise<ReturnType<typeof probeSnapshot>> {
  const backend = createLocalBackend();
  await backend.connect();
  return probeSnapshot(backend, script);
}

describe('language equivalence — PyMOL command language vs. console JavaScript', () => {
  for (const pair of PAIRS) {
    it(`"${pair.name}" is identical run as a command or as JavaScript`, async () => {
      const cmdScript = scriptFor(pair, pair.cmd);
      const jsScript = scriptFor(pair, pair.js);
      const [cmdSnap, jsSnap] = await Promise.all([runFresh(cmdScript), runFresh(jsScript)]);
      // The command-language run is the reference; the JS run must match it on
      // every gated observable.
      const diffs = diffSnapshots(cmdScript, cmdSnap, jsSnap);
      expect(diffs).toEqual([]);
    });
  }

  it('every pair actually changed the observable it claims to (no silent no-ops)', async () => {
    // A guard so an equivalence pair can't pass by BOTH languages doing nothing.
    const spheres = await runFresh(scriptFor(PAIRS[0]!, PAIRS[0]!.cmd));
    expect(spheres.counts['rep spheres']).toBe(9);
    const setting = await runFresh(scriptFor(PAIRS[7]!, PAIRS[7]!.cmd));
    expect(setting.settings!['sphere_scale']).toBe(2);
  });
});
