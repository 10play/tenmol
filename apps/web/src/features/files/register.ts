import type { FeatureModule } from '../registry';
import { FilesPanel } from './FilesPanel';

/** Slot `files`, region `overlay`. Plan §6 WP-18, parity inventory area 6. */
const feature: FeatureModule = { id: 'files', Panel: FilesPanel };
export default feature;
