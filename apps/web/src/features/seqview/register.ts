import type { FeatureModule } from '../registry';
import { SequenceViewer } from './SequenceViewer';

/** Slot `seqview`, region `viewport`. Plan §6 WP-21. */
const feature: FeatureModule = { id: 'seqview', Panel: SequenceViewer };
export default feature;
