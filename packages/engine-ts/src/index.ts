/**
 * @tenmol/engine-ts
 *
 * An in-browser TypeScript port of the PyMOL engine, exposed as a
 * `@tenmol/backend` `Backend`. The app runs against this instead of the Python
 * bridge simply by constructing `createLocalBackend()` in place of
 * `createRemoteBackend()` — everything above the `Backend` seam is identical.
 *
 * Parity with real PyMOL over the covered command slice is proven by the
 * differential suite in `tools/parity`.
 */

export { LocalBackend, createLocalBackend, type LocalBackendOptions } from './backend';
export { Engine } from './engine';
export { Executive } from './exec/executive';
export { parsePdb } from './model/pdb';
export { ObjectMolecule } from './model/molecule';
export { selectAtoms, countAtoms, SelectionError } from './select/selector';
export { getColorIndex, getColorTuple, rgbForIndex } from './exec/color';
export { ViewState, defaultView, VIEW_LENGTH } from './view/view';
export { buildSpheresFrame, buildLinesFrame } from './geometry/frames';
