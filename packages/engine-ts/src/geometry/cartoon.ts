/**
 * Mode-G geometry for the `cartoon` representation.
 *
 * Cartoon is a triangulated ribbon/tube through the backbone, its cross-section
 * chosen by secondary structure (`atom.ss`, assigned by `dss`): a flat arrowed
 * ribbon for strands ('S'), a wide flat helix ribbon for 'H', a thin tube for
 * loops. It is emitted as an `indexed-mesh` frame (position/normal/color/index),
 * which the viewport already draws with its lit triangle-mesh material — so no
 * renderer changes are needed, only this geometry builder.
 *
 * STUB: returns null (nothing drawn) until implemented.
 */

import type { RepBuilder } from './registry';

export const buildCartoonFrame: RepBuilder = () => null;
