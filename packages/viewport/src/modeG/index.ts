export {
  createGeometryRenderer,
  isWebGL2Available,
  FOG_START,
  type GeometryRenderer,
  type GeometryRendererOptions,
  type GeometryRendererStats,
} from './renderer';
export {
  buildGeometry,
  fanIndices,
  isEmptyGeometryFrame,
  stripIndices,
  type BuiltGeometry,
} from './frames';
export {
  CURRENT_STATE,
  EMPTY_STATUSES,
  FALLBACK_STATUSES,
  createGeometryCache,
  describeKey,
  parseVersionTable,
  resolvedKey,
  tombstoneFrame,
  type CachePlan,
  type GeometryCache,
  type GeometryCacheEntry,
  type GeometryCacheStats,
  type PullResult,
  type ResolvedKey,
  type VersionRow,
  type VersionTable,
} from './cache';
export {
  DEFAULT_POLL_MS,
  RENDER_STATS_FN,
  createInvalidationPoller,
  type InvalidationPoller,
  type InvalidationPollerOptions,
  type InvalidationPollerStats,
} from './invalidation';
export {
  DRAWABLE_INSTANCE_KINDS,
  buildInstancedDraw,
  isDrawableInstanceKind,
  type InstancedDraw,
} from './instances';
export {
  GEOMETRY_PULL_FN,
  createStaticGeometrySource,
  createStreamGeometrySource,
  type StaticGeometrySourceOptions,
  type StreamGeometrySource,
  type StreamGeometrySourceOptions,
} from './sources';
export { LIGHTING_GLSL, LIGHT_DEFAULTS, lightingUniforms } from './materials/lighting';
export { createSphereMaterial } from './materials/sphere';
export { createCylinderMaterial } from './materials/cylinder';
export { createVertexMaterial, type VertexMaterialFlags } from './materials/vertex';
