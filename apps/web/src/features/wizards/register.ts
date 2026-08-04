import type { FeatureModule } from '../registry';
import { WizardsPanel } from './WizardsPanel';

/** Slot `wizards`, region `internal-gui`. Plan §6 WP-16. */
const feature: FeatureModule = { id: 'wizards', Panel: WizardsPanel };
export default feature;
