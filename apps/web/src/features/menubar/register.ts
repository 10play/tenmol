import type { FeatureModule } from '../registry';
import { MenuBar } from './MenuBar';

/** Slot `menubar`, region `menubar`. Plan §6 WP-14. */
const feature: FeatureModule = { id: 'menubar', Panel: MenuBar };
export default feature;
