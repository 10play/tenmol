import type { FeatureModule } from '../registry';
import { ShortcutsService } from './ShortcutsService';

/**
 * Slot `shortcuts`, region `service`. Plan §6 WP-23 — "Key translation, the
 * shortcut editor, and the ButMode grid".
 */
const feature: FeatureModule = { id: 'shortcuts', Panel: ShortcutsService };
export default feature;
