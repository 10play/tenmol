import type { FeatureModule } from '../registry';
import { ColorsPanel } from './ColorsPanel';

/** Slot `colors`, region `overlay`. Plan §6 WP-22. */
const feature: FeatureModule = { id: 'colors', Panel: ColorsPanel };
export default feature;
