import type { FeatureModule } from '../registry';
import { TextEditorSlot } from './TextEditorPanel';

/** Slot `texteditor`, region `overlay`. Plan §6 WP-22; inventory area 10. */
const feature: FeatureModule = { id: 'texteditor', Panel: TextEditorSlot };
export default feature;
