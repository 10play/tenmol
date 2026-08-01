import type { FeatureModule } from '../registry';
import { RenderDialog } from './RenderDialog';

/** Slot `render`, region `viewport`. Plan §6 WP-19 — the Draw/Ray form. */
const feature: FeatureModule = { id: 'render', Panel: RenderDialog };
export default feature;
