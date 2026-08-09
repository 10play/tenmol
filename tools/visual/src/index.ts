/**
 * @tenmol/visual — the shared visual-render corpus. The scene list is consumed
 * by both the browser render-only harness (apps/web) and the PyMOL reference
 * generator (generate-refs.mjs), so both render the identical scenes.
 */
export { SCENES, sceneById, type Scene, type Op } from './scenes';
