/**
 * Mode P / Mode G composition — defect **D2**.
 *
 * `composition.ts` is the rule (pure); `wiring.ts` is the controller that
 * declares to the bridge and switches the renderer. `viewport.ts` is the only
 * consumer.
 */

export {
  EMPTY_COMPOSITION,
  compose,
  compositionChanged,
  declaration,
  declarationChanged,
  type CompositionFrame,
  type CompositionState,
} from './composition';
export {
  PIXEL_STREAM_FN,
  createCompositor,
  type Compositor,
  type CompositorOptions,
  type CompositorTransport,
} from './wiring';
