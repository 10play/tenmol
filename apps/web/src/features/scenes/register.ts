import type { FeatureModule } from '../registry';
import { ScenePanel } from './ScenePanel';

/** Slot `scenes`, region `internal-gui`. Plan §6 WP-20. */
const feature: FeatureModule = { id: 'scenes', Panel: ScenePanel };
export default feature;
