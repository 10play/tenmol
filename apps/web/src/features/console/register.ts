import type { FeatureModule } from '../registry';
import { ConsolePanel } from './ConsolePanel';

/** Slot `console`, region `external-gui`. Plan §6 WP-11. */
const feature: FeatureModule = { id: 'console', Panel: ConsolePanel };
export default feature;
