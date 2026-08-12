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

  // PyMOL's `surface` is the TRUE solvent-EXCLUDED surface (RepSurface's
  // SolventDot/SurfaceJob), i.e. the morphological closing of the vdW solid by
  // the probe — smooth re-entrant surfaces in the concave crevices a rolling
  // probe bridges, convex contact patches on the exposed atoms. `ses: true`
  // computes exactly that (distance-transform erosion of the SAS solid), which
  // matches PyMOL far better than the old isotropic shrink+blur approximation
  // (that over-rounded the silhouette and left per-atom bumps). A couple of light
  // Taubin passes then remove marching-cubes facet noise without moving the level.
  const mesh = generateSurface(mol, state, repBit(Rep.Surface), {
    probe,
    ses: true,
    smooth: true,
    smoothPasses: 2,
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
