/**
 * The rep-builder registry — the seam that lets each representation's Mode-G
 * geometry live in its OWN module. The engine looks a rep up here instead of a
 * hard-coded switch, so a new rep is added by writing one `build<Rep>Frame`
 * function and registering it below; nothing else in the engine changes.
 */

import { Rep, type RepId } from '@tenmol/protocol';
import type { ObjectMolecule } from '../model/molecule';
import {
  buildLinesFrame,
  buildNbSpheresFrame,
  buildNonbondedFrame,
  buildSpheresFrame,
  buildSticksFrame,
} from './frames';
import { buildCartoonFrame } from './cartoon';
import { buildRibbonFrame } from './ribbon';
import { buildSurfaceFrame } from './surface';
import { buildMeshFrame } from './mesh';
import { buildDotsFrame } from './dots';

/** Everything a rep geometry builder needs from the engine to build one frame. */
export interface RepBuildCtx {
  mol: ObjectMolecule;
  state: number;
  /** Monotonic frame sequence number to stamp on the frame header. */
  seq: number;
  /** Read a float setting, resolved through the executive (PyMOL defaults applied). */
  getSettingFloat(name: string): number;
}

/** Builds one object/state's Mode-G frame for a rep, or `null` if nothing to draw. */
export type RepBuilder = (ctx: RepBuildCtx) => ArrayBuffer | null;

/**
 * RepId → builder. Adding a rep = add one entry here pointing at a builder in a
 * disjoint `geometry/<rep>.ts` module. `RENDERABLE_REPS` is derived from the keys.
 */
export const REP_BUILDERS: Partial<Record<RepId, RepBuilder>> = {
  [Rep.Line]: ({ mol, state, seq }) => buildLinesFrame(mol, state, seq),
  [Rep.Sphere]: ({ mol, state, seq, getSettingFloat }) =>
    buildSpheresFrame(mol, state, seq, getSettingFloat('sphere_scale') || 1),
  [Rep.Cyl]: ({ mol, state, seq, getSettingFloat }) =>
    buildSticksFrame(mol, state, seq, getSettingFloat('stick_radius') || 0.25),
  [Rep.Nonbonded]: ({ mol, state, seq }) => buildNonbondedFrame(mol, state, seq),
  [Rep.NonbondedSphere]: ({ mol, state, seq, getSettingFloat }) =>
    buildNbSpheresFrame(mol, state, seq, getSettingFloat('nb_spheres_size') || 0.25),
  [Rep.Cartoon]: buildCartoonFrame,
  [Rep.Ribbon]: buildRibbonFrame,
  [Rep.Surface]: buildSurfaceFrame,
  [Rep.Mesh]: buildMeshFrame,
  [Rep.Dot]: buildDotsFrame,
};

/** The reps this engine can render in Mode G today (the registry's keys). */
export const RENDERABLE_REPS: readonly RepId[] = Object.keys(REP_BUILDERS).map(Number);

/** True when a rep has a registered Mode-G builder. */
export function isRenderableRep(rep: RepId): boolean {
  return REP_BUILDERS[rep] !== undefined;
}
