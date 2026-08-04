import type { FeatureModule } from '../registry';
import { DialogsPanel } from './DialogsPanel';

/** Slot `dialogs`, region `overlay`. Inventory area 10 (WP-22 share). */
const feature: FeatureModule = { id: 'dialogs', Panel: DialogsPanel };
export default feature;
