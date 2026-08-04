import type { FeatureModule } from '../registry';
import { PluginManager } from './PluginManager';

/** Slot `plugin-manager`, region `overlay`. Plan §6 WP-25b, read-only in v1. */
const feature: FeatureModule = { id: 'plugin-manager', Panel: PluginManager };
export default feature;
