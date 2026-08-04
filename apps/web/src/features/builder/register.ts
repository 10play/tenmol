import type { FeatureModule } from '../registry';
import { BuilderPanel } from './BuilderPanel';

/** Slot `builder`, region `overlay`. Plan §6 WP-17, parity inventory area 9. */
const feature: FeatureModule = { id: 'builder', Panel: BuilderPanel };
export default feature;
