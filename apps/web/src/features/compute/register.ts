import type { FeatureModule } from '../registry';
import { ComputePanel } from './ComputePanel';

/** Slot `compute`, region `overlay`. Plan §6 WP-24 / critique B9. */
const feature: FeatureModule = { id: 'compute', Panel: ComputePanel };
export default feature;
