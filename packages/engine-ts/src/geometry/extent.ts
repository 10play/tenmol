/**
 * Mode-G geometry for the `extent` representation — the axis-aligned bounding
 * box of the extent-flagged atoms, as a white wireframe (line instances).
 */

import { Rep } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { RepBuilder } from './registry';
import { aabbCorners, boxEdgesFromCorners, buildBoxFrame, type Vec3 } from './boxlines';

export const buildExtentFrame: RepBuilder = ({ mol, state, seq }) => {
  const bit = repBit(Rep.Extent);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (let i = 0; i < mol.natom; i++) {
    if ((mol.atoms[i]!.visRep & bit) === 0) continue;
    const p = mol.coord(i, state);
    for (let k = 0; k < 3; k++) {
      if (p[k]! < min[k]!) min[k] = p[k]!;
      if (p[k]! > max[k]!) max[k] = p[k]!;
    }
    any = true;
  }
  if (!any) return null;
  const edges = boxEdgesFromCorners(aabbCorners(min, max));
  return buildBoxFrame(mol.name, state, seq, Rep.Extent, edges, [1, 1, 1]);
};
