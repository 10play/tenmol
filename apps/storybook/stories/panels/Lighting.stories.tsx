/**
 * Lighting settings — the real {@link LightingPanel} sub-surface of the settings
 * overlay.
 *
 * The five presets (Default, Ray-trace, X-ray, Cartoon, Nucleic) over the
 * slider/number table copied from `lightingsettings_gui/main.py`. The panel
 * takes the settings store + source; here they come from the same
 * module-level settings service the real overlay uses, read off the stub
 * session. With no catalogue the sliders sit at their authored defaults — the
 * modern theme's card chrome on the full lighting table.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useSession } from '@web/app';
import { LightingPanel } from '@web/features/settings/LightingPanel';
import { getSettingsService } from '@web/features/settings/service';
import { withSettingsData } from './settingsSession';

/** Feeds {@link LightingPanel} the settings store/source from the live service. */
function LightingHost() {
  const session = useSession();
  const { store, source } = getSettingsService(session);
  return <LightingPanel store={store} source={source} />;
}

const meta = {
  title: 'Panels/Lighting',
  parameters: { layout: 'padded' },
  decorators: [withSettingsData],
} satisfies Meta<typeof LightingHost>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The presets row and the full lighting slider table at their defaults. */
export const Default: Story = {
  render: () => <LightingHost />,
};
