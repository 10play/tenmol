/**
 * @tenmol/viewport — the 3D viewport.
 *
 *     import { createViewport, Rep } from '@tenmol/viewport';
 *
 *     const viewport = createViewport({ container, transport });
 *     viewport.setRepMode(Rep.Sphere, 'geometry');   // per-rep Mode G
 *
 * Mode P (server-rendered pixels) is the default and the correctness baseline;
 * Mode G (three.js drawing PyMOL's own geometry) is opt-in per rep and falls
 * back to Mode P by itself whenever it cannot express a rep.
 *
 * Everything here is framework-free. `apps/web/src/features/viewport` is the
 * React binding.
 */

export { createViewport } from './viewport';
export { createSurface, type ViewportSurface } from './surface';
export { createResizeNegotiator, type ResizeNegotiator, type SizeState } from './resize';
export { createLabelOverlay, type LabelOverlay, type LabelPoint } from './labels';
export {
  DEFAULT_POLICY,
  createRenderPolicy,
  isModeGCapable,
  type RenderPolicyCaps,
  type RenderPolicyController,
} from './renderPolicy';
export { bindConnection, type ConnectionLike } from './transport';

export * from './camera';
export * from './input';
export * from './modeP';
export * from './modeG';

export type {
  GeometrySink,
  GeometrySource,
  PixelFramePayload,
  PixelSink,
  PixelSource,
  ViewportHandle,
  ViewportOptions,
  ViewportStats,
  ViewportTransport,
} from './types';

// Re-exported so an app needs one import for the rep table and the mode names.
export {
  MODE_G_CAPABLE_REPS,
  REP_NAMES,
  Rep,
  repName,
  type RenderMode,
  type RenderModePolicy,
  type RepId,
  type RepRenderState,
} from '@tenmol/protocol';
