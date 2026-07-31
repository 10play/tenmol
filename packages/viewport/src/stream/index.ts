/**
 * `@tenmol/viewport/stream` — stream lifecycle that is NOT about pixels
 * themselves: when a client should stop consuming them, and whose stream a
 * pause applies to.
 *
 * `modeP/sources.ts` owns "where frames come from"; this owns "when this client
 * wants them at all". The split exists because pausing is per CLIENT and the
 * bridge's `paused` flag is per PROCESS (see `./pause.ts`).
 */

export {
  createPauseCoordinator,
  createStreamPauseController,
  perClientPause,
  type PauseCoordinator,
  type PauseReason,
  type PerClientPauseOptions,
  type PerClientPauseSource,
  type PerClientPauseStats,
  type StreamPauseController,
  type StreamPauseControllerOptions,
} from './pause';

export {
  createVisibilityController,
  isDocumentHidden,
  type VisibilityController,
  type VisibilityControllerOptions,
  type VisibilityDocumentLike,
  type VisibilitySource,
  type VisibilityWindowLike,
} from './visibility';
