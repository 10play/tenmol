import type { FeatureModule } from '../registry';
import { ViewportPanel } from './ViewportPanel';

/** Slot `viewport`, region `viewport`. Plan §6 WP-09. */
const feature: FeatureModule = { id: 'viewport', Panel: ViewportPanel };
export default feature;
