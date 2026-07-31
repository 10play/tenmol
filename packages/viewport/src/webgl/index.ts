/**
 * Mode-G WebGL: the geometry builder and the scene that draws it.
 *
 * `buildGeometry` here is what `../modeG/renderer.ts` calls: it replaced
 * `../modeG/frames.ts`'s export of the same name, which is now kept only for
 * `isEmptyGeometryFrame` and the shared `BuiltGeometry` type. See `./builder.ts`
 * for the list of defects that motivated it.
 *
 * (`./scene.ts` used to live here as a standalone renderer built only so the
 * D6 work could be photographed without editing `../modeG/renderer.ts`. The
 * renderer now uses this builder directly, so it was deleted rather than left
 * as a second, silently diverging implementation.)
 */

export {
  buildGeometry,
  unmappedCensus,
  stripIndices,
  fanIndices,
  type BuildOptions,
} from './builder';
export {
  buildInstancedDraw,
  isDrawableInstanceKind,
  maxSphereRadius,
  DRAWABLE_INSTANCE_KINDS,
  type InstancedDraw,
  type InstanceDrawOptions,
} from './instances';
export { buildIndexedMesh, stripLineIndices, visibleTriangleIndices, type BuiltMesh } from './mesh';
