/**
 * Settings overlay — the real {@link SettingsPanel} feature bundle.
 *
 * The `settings` slot carries its own launcher (WP-14's menu bar is not
 * installed yet): a three-button row — Setting menu, Edit All…, Lighting — plus
 * a phase pill. Mounted on the stub session, whose settings service never
 * reaches `ready`, so the pill reads its idle phase and any window opened shows
 * the "loading the setting catalogue…" state — the modern theme's floating-card
 * chrome around a genuine, connected-but-empty control surface.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsPanel } from '@web/features/settings/SettingsPanel';
import { withSettingsCatalogue } from './settingsSession';

const meta = {
  title: 'Panels/Settings',
  parameters: { layout: 'padded' },
  decorators: [withSettingsCatalogue],
} satisfies Meta<typeof SettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The settings launcher row at rest — the three window buttons and phase pill. */
export const Default: Story = {
  render: () => <SettingsPanel />,
};

/**
 * Clicks the launcher button whose text matches `label` once, after mount, so
 * the story lands on the opened window frame instead of the bare launcher.
 */
function OpenWindow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const btn = Array.from(ref.current?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.trim().startsWith(label),
    );
    (btn as HTMLButtonElement | undefined)?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** The Setting-menu window opened over the launcher — the `setwin` card frame. */
export const SettingMenuOpen: Story = {
  render: () => (
    <OpenWindow label="Setting">
      <SettingsPanel />
    </OpenWindow>
  ),
};

/** The Advanced Settings table (`Edit All…`) over the seeded 779-row catalogue. */
export const EditAllOpen: Story = {
  render: () => (
    <OpenWindow label="Edit All">
      <SettingsPanel />
    </OpenWindow>
  ),
};

/** The Lighting window opened over the launcher. */
export const LightingOpen: Story = {
  render: () => (
    <OpenWindow label="Lighting">
      <SettingsPanel />
    </OpenWindow>
  ),
};
