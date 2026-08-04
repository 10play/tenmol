import type { FeatureModule } from '../registry';
import { KeyboardService } from './KeyboardService';

/**
 * Slot `keyboard`, region `service`. Plan §6 WP-23.
 *
 * It renders `null`; the whole feature is the `keydown` listener the panel
 * installs. (`FeatureModule.install` exists but the shell never calls it — the
 * effect has to hang off the mounted panel.)
 */
const feature: FeatureModule = { id: 'keyboard', Panel: KeyboardService };
export default feature;
