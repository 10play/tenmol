import type { FeatureModule } from '../registry';
import { ApbsPanel } from './ApbsPanel';

/** Slot `apbs`, region `overlay`. Plan §6 WP-25a — visible stub, full port is WP-30. */
const feature: FeatureModule = { id: 'apbs', Panel: ApbsPanel };
export default feature;
