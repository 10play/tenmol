/**
 * The shared visual-render corpus: the SAME scenes rendered by real PyMOL (the
 * reference generator, `generate-refs.mjs`) and by the in-browser three.js
 * viewport (the render-only harness, `apps/web/src/features/render`). Because
 * both sides run the identical op script and the identical camera, the two
 * renders can be diffed pixel-for-pixel.
 *
 * Pure data — no engine/browser/node imports — so it is safe in both bundles.
 *
 * `pdb` names a file served at `/visual/<pdb>` (from `apps/web/public/visual/`)
 * and read from disk by the generator. `ops` run AFTER the PDB is loaded and
 * BEFORE the camera is set. `view` is the 18-float `set_view` tuple; when empty
 * both sides `orient` + `zoom` instead. The generator fills `view` from PyMOL's
 * `orient` (see `generate-refs.mjs`) so the framing is identical on both sides.
 */

/** One command: `[method, ...args]`, run via `backend.call(method, args)`. */
export type Op = [string, ...unknown[]];

export interface Scene {
  id: string;
  /** PDB filename under `/visual/` (apps/web/public/visual). */
  pdb: string;
  /** Object name to load under (defaults to the pdb basename). */
  obj?: string;
  /** Commands run after load, before the camera is set. */
  ops: Op[];
  /** 18-float `set_view` tuple; empty -> `orient`+`zoom`. Filled by the generator. */
  view?: number[];
  width: number;
  height: number;
  /** Background colour name (`bg_color`). */
  bg: string;
  /** Extra `set(name, value)` calls applied before rendering. */
  settings?: Array<[string, string | number]>;
  /** Draw text labels (the harness feeds the label overlay). */
  labels?: boolean;
  tier: 'small' | 'medium' | 'large';
}

const W = 640;
const H = 480;
const BG = 'black';

/** Colour-by-secondary-structure ops (red helices, yellow strands, green loops). */
const colorBySs: Op[] = [
  ['color', 'red', 'ss H'],
  ['color', 'yellow', 'ss S'],
  ['color', 'green', 'ss L+'],
];

function scene(s: Omit<Scene, 'width' | 'height' | 'bg'> & Partial<Pick<Scene, 'width' | 'height' | 'bg'>>): Scene {
  return { width: W, height: H, bg: BG, ...s };
}

export const SCENES: Scene[] = [
  // ---- small peptide (pept.pdb, ~107 atoms) ----
  scene({ id: 'pept-cartoon-rainbow', pdb: 'pept.pdb', tier: 'small',
    ops: [['dss'], ['hide', 'everything'], ['show', 'cartoon'], ['spectrum', 'count', 'rainbow', 'name CA']] }),
  scene({ id: 'pept-cartoon-ss', pdb: 'pept.pdb', tier: 'small',
    ops: [['dss'], ['hide', 'everything'], ['show', 'cartoon'], ...colorBySs] }),
  scene({ id: 'pept-sticks-element', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'sticks'], ['util.cbag', 'all']] }),
  scene({ id: 'pept-sticks-thick', pdb: 'pept.pdb', tier: 'small', settings: [['stick_radius', 0.4]],
    ops: [['hide', 'everything'], ['show', 'sticks'], ['util.cbag', 'all']] }),
  scene({ id: 'pept-lines', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'lines'], ['util.cbag', 'all']] }),
  scene({ id: 'pept-spheres', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'spheres'], ['util.cbag', 'all']] }),
  scene({ id: 'pept-spheres-half', pdb: 'pept.pdb', tier: 'small', settings: [['sphere_scale', 0.5]],
    ops: [['hide', 'everything'], ['show', 'spheres'], ['util.cbag', 'all']] }),
  scene({ id: 'pept-ribbon', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'ribbon'], ['spectrum', 'count', 'rainbow', 'name CA']] }),
  scene({ id: 'pept-surface', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'surface'], ['color', 'marine']] }),
  scene({ id: 'pept-mesh', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'mesh'], ['color', 'green']] }),
  scene({ id: 'pept-dots', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'dots'], ['util.cbag', 'all']] }),
  scene({ id: 'pept-labels', pdb: 'pept.pdb', tier: 'small', labels: true,
    ops: [['hide', 'everything'], ['show', 'sticks'], ['util.cbag', 'all'], ['label', 'name CA', 'resn+resi']] }),
  scene({ id: 'pept-dashes', pdb: 'pept.pdb', tier: 'small',
    ops: [['hide', 'everything'], ['show', 'sticks'], ['util.cbag', 'all'],
      ['distance', 'd1', 'resi 1 and name CA', 'resi 5 and name CA']] }),

  // ---- medium helix (helix.pdb, ~392 atoms) ----
  scene({ id: 'helix-cartoon', pdb: 'helix.pdb', tier: 'medium',
    ops: [['dss'], ['hide', 'everything'], ['show', 'cartoon'], ['spectrum', 'count', 'rainbow', 'name CA']] }),
  scene({ id: 'helix-surface', pdb: 'helix.pdb', tier: 'medium',
    ops: [['hide', 'everything'], ['show', 'surface'], ['color', 'slate']] }),
  scene({ id: 'helix-sticks', pdb: 'helix.pdb', tier: 'medium',
    ops: [['hide', 'everything'], ['show', 'sticks'], ['util.cbag', 'all']] }),

  // ---- small protein (3al1.pdb, ~679 atoms) ----
  scene({ id: '3al1-cartoon-rainbow', pdb: '3al1.pdb', tier: 'large',
    ops: [['dss'], ['hide', 'everything'], ['show', 'cartoon'], ['spectrum', 'count', 'rainbow', 'name CA']] }),
  scene({ id: '3al1-cartoon-ss', pdb: '3al1.pdb', tier: 'large',
    ops: [['dss'], ['hide', 'everything'], ['show', 'cartoon'], ...colorBySs] }),
  scene({ id: '3al1-surface', pdb: '3al1.pdb', tier: 'large',
    ops: [['hide', 'everything'], ['show', 'surface'], ['color', 'marine']] }),
  scene({ id: '3al1-surface-bfactor', pdb: '3al1.pdb', tier: 'large',
    ops: [['hide', 'everything'], ['show', 'surface'], ['spectrum', 'b']] }),
  scene({ id: '3al1-sticks-element', pdb: '3al1.pdb', tier: 'large',
    ops: [['hide', 'everything'], ['show', 'sticks'], ['util.cbag', 'all']] }),
  scene({ id: '3al1-spheres', pdb: '3al1.pdb', tier: 'large',
    ops: [['hide', 'everything'], ['show', 'spheres'], ['util.cbag', 'all']] }),
];

export function sceneById(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id);
}
