import type { FeatureModule } from '../registry';
import { PropertiesSlot } from './PropertiesPanel';

/** Slot `properties`, region `overlay`. Plan §6 WP-22; inventory area 10. */
const feature: FeatureModule = { id: 'properties', Panel: PropertiesSlot };
export default feature;
