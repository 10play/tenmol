import type { FeatureModule } from '../registry';
import { SettingsPanel } from './SettingsPanel';

/** Slot `settings`, region `overlay`. Plan §6 WP-15. */
const feature: FeatureModule = { id: 'settings', Panel: SettingsPanel };
export default feature;
