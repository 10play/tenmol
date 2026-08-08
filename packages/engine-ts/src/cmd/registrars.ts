/**
 * The list of command-subsystem registrars the engine wires up. Each subsystem
 * lives in its own module and adds its `cmd.*` handlers through a shared
 * {@link RegistrarCtx}; the engine iterates this list once, so a new subsystem
 * is added by writing one `cmd/<name>.ts` module and appending it here.
 */

import type { RegistrarCtx } from './registrar';
import { registerColoring } from './coloring';
import { registerTransforms } from './transforms';
import { registerAnalysis } from './analysis';
import { registerMeasurement } from './measurement';
import { registerObjects } from './objects';
import { registerFileio } from './fileio';
import { registerEditing } from './editing';
import { registerDisplay } from './display';
import { registerSettings2 } from './settings2';
import { registerSystem } from './system';

/** Every subsystem registrar, applied in order to the engine's context. */
export const ALL_REGISTRARS: ReadonlyArray<(ctx: RegistrarCtx) => void> = [
  registerColoring,
  registerTransforms,
  registerAnalysis,
  registerMeasurement,
  registerObjects,
  registerFileio,
  registerEditing,
  registerDisplay,
  registerSettings2,
  registerSystem,
];
