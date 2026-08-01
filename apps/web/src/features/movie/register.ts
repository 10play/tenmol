import type { FeatureModule } from '../registry';
import { MoviePanel } from './MoviePanel';

/** Slot `movie`, region `internal-gui`. Plan §6 WP-20. */
const feature: FeatureModule = { id: 'movie', Panel: MoviePanel };
export default feature;
