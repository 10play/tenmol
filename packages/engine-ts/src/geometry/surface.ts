/**
 * Mode-G geometry for the `surface` representation — an approximate molecular
 * (solvent-accessible) surface as a lit triangle mesh, emitted as ONE
 * `indexed-mesh` frame (position/normal/color/index/atom). The heavy lifting —
 * the scalar field and marching cubes — lives in the shared {@link generateSurface}
 * generator, which the `mesh` rep reuses; here we only run it for the atoms
 * carrying the surface bit and pack the result into a frame.
 */

import { Rep, type BufferRef, type IndexedMeshHeader } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import { PayloadBuilder, encode } from './payload';
import type { RepBuilder } from './registry';
import { generateSurface, DEFAULT_PROBE } from './surface_gen';

/** Filled in by the builder; never read before assignment. */
const PLACEHOLDER: BufferRef = { byteOffset: 0, byteLength: 0, dtype: 'f32', itemSize: 3 };

/**
 * Build the `surface` indexed-mesh frame for one object/state, or `null` when no
 * atom carries the surface rep (or the generated mesh is empty).
 */
export const buildSurfaceFrame: RepBuilder = ({ mol, state, seq, getSettingFloat }) => {
  const probe = getSettingFloat('solvent_radius') || DEFAULT_PROBE;

  // Count the atoms actually carrying the surface rep. The inward SES level-shift
  // that best matches PyMOL depends on molecular SIZE: a small peptide's
  // solvent-excluded surface reads relatively PUFFIER (fewer buried atoms, less
  // fused interior), so it wants a smaller inward shift, while a compact protein
  // packs into a tighter, more fused blob. A single global shrink over- or
  // under-shrinks one end; keying it to the flagged-atom count tracks PyMOL's
  // silhouette across the whole size range far better.
  let nSurf = 0;
  for (let i = 0; i < mol.natom; i++) {
    const a = mol.atoms[i];
    if (a && (a.visRep & repBit(Rep.Surface)) !== 0) nSurf++;
  }
  const shrink = nSurf < 200 ? 0.7 : nSurf < 500 ? 0.9 : 0.8;

  // PyMOL's solvent-excluded surface reads as a smooth, fused blob; a raw
  // marching-cubes SAS still shows individual atom bumps. Extra Taubin passes
  // melt those bumps together so the silhouette and shading match PyMOL.
  const mesh = generateSurface(mol, state, repBit(Rep.Surface), {
    probe,
    smooth: true,
    smoothPasses: 3,
    fieldBlur: 4,
    shrink,
  });
  if (!mesh) return null;

  const verts = mesh.atoms.length;
  const tris = mesh.indices.length / 3;
  if (verts === 0 || tris === 0) return null;

  const builder = new PayloadBuilder();
  const buffers: IndexedMeshHeader['buffers'] = { position: PLACEHOLDER };
  builder.addF32(mesh.positions, 3, (ref) => (buffers.position = ref));
  builder.addF32(mesh.normals, 3, (ref) => (buffers.normal = ref));
  builder.addF32(mesh.colors, 4, (ref) => (buffers.color = ref));
  builder.addU32(mesh.indices, 3, (ref) => (buffers.index = ref));
  builder.addI32(mesh.atoms, 1, (ref) => (buffers.atom = ref));
  const payload = builder.build();

  const header: IndexedMeshHeader = {
    v: 1,
    kind: 'indexed-mesh',
    seq,
    payloadBytes: payload.byteLength,
    object: mol.name,
    state,
    rep: Rep.Surface,
    counts: { verts, tris },
    buffers,
    proximity: false,
    oneColor: null,
  };
  return encode(header, payload);
};
