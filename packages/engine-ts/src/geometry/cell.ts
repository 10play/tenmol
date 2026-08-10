/**
 * Mode-G geometry for the `cell` representation — the crystallographic unit-cell
 * box (from the molecule's CRYST1 cell) as a wireframe (line instances). Only
 * drawn when the object has a cell and any atom carries the cell rep bit.
 */

import { Rep } from '@tenmol/protocol';
import { repBit } from '../model/atom';
import type { RepBuilder } from './registry';
import { boxEdgesFromCorners, buildBoxFrame, type Vec3 } from './boxlines';

/** Fractional -> Cartesian orthogonalisation matrix rows (PDB convention). */
function fracToCart(cell: {
  a: number; b: number; c: number; alpha: number; beta: number; gamma: number;
}): (f: Vec3) => Vec3 {
  const d2r = Math.PI / 180;
  const al = cell.alpha * d2r;
  const be = cell.beta * d2r;
  const ga = cell.gamma * d2r;
  const cosA = Math.cos(al);
  const cosB = Math.cos(be);
  const cosG = Math.cos(ga);
  const sinG = Math.sin(ga);
  const v = Math.sqrt(1 - cosA * cosA - cosB * cosB - cosG * cosG + 2 * cosA * cosB * cosG);
  // Columns are the cell vectors a, b, c in Cartesian space.
  const ax = cell.a;
  const bx = cell.b * cosG;
  const by = cell.b * sinG;
  const cx = cell.c * cosB;
  const cy = (cell.c * (cosA - cosB * cosG)) / sinG;
  const cz = (cell.c * v) / sinG;
  return (f: Vec3): Vec3 => [
    ax * f[0] + bx * f[1] + cx * f[2],
    by * f[1] + cy * f[2],
    cz * f[2],
  ];
}

export const buildCellFrame: RepBuilder = ({ mol, state, seq }) => {
  const cell = mol.cell;
  if (!cell) return null;
  const bit = repBit(Rep.Cell);
  let any = false;
  for (let i = 0; i < mol.natom; i++) {
    if ((mol.atoms[i]!.visRep & bit) !== 0) { any = true; break; }
  }
  if (!any) return null;
  const toCart = fracToCart(cell);
  // The 8 corners of the fractional unit cube, ordered as in aabbCorners.
  const cube: Vec3[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const corners = cube.map(toCart);
  const edges = boxEdgesFromCorners(corners);
  return buildBoxFrame(mol.name, state, seq, Rep.Cell, edges, [1, 1, 1]);
};
