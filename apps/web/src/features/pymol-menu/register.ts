import type { FeatureModule } from '../registry';
import { MenuHost } from './MenuHost';

/**
 * Slot `pymol-menu`, region `service`. Plan §6 WP-13.
 *
 * It renders nothing until something calls `pymolMenu.openAt(...)`; the slot
 * exists so exactly one pop-up host is mounted for the whole application — and,
 * since the leaf-hook seam landed, so that hooks have somewhere ALWAYS MOUNTED
 * to register from (`MenuHost`, `leafHooks.ts`).
 */
const feature: FeatureModule = { id: 'pymol-menu', Panel: MenuHost };
export default feature;
