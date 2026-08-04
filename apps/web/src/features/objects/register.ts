import type { FeatureModule } from '../registry';
import { ObjectPanel } from './ObjectPanel';

/** Slot `objects`, region `internal-gui`. Plan §6 WP-12. */
const feature: FeatureModule = { id: 'objects', Panel: ObjectPanel };
export default feature;
