import type { FeatureModule } from '../registry';
import { PopupMenu } from './PopupMenu';

/**
 * Slot `pymol-menu`, region `service`. Plan §6 WP-13.
 *
 * It renders nothing until something calls `pymolMenu.openAt(...)`; the slot
 * exists so exactly one pop-up host is mounted for the whole application.
 */
const feature: FeatureModule = { id: 'pymol-menu', Panel: PopupMenu };
export default feature;
