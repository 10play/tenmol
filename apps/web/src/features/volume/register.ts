import type { FeatureModule } from '../registry';
import { VolumeSlot } from './VolumePanel';

/** Slot `volume`, region `overlay`. Plan §6 WP-22; inventory area 10. */
const feature: FeatureModule = { id: 'volume', Panel: VolumeSlot };
export default feature;
