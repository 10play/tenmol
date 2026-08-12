/**
 * Molecular Builder — the real {@link BuilderPanel} feature bundle.
 *
 * The upstream `BuilderPanelDocked` three-tab panel (Chemical / Fragments /
 * Editing) over its always-visible action rows, plus the pk1..pk4 pick chips.
 * Every button's enablement comes from PyMOL's `builder_action` handler, so on
 * the stub session — which has no picked atoms and never returns editor state —
 * the panel renders its default, nothing-picked layout. Clean stays disabled
 * with its reason in the tooltip, exactly as upstream. This shows the modern
 * theme's card chrome around a genuine, connected-but-idle editor.
 */

import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { BuilderPanel, OPEN_EVENT } from '@web/features/builder/BuilderPanel';

import { withBuilderData } from './builderSession';

const meta = {
  title: 'Panels/Builder',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof BuilderPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The collapsed Builder tab, as it first mounts in the shell's overlay. */
export const Default: Story = {
  decorators: [withBuilderData],
  render: () => <BuilderPanel />,
};

/**
 * The Builder expanded — dispatches its own {@link OPEN_EVENT} on mount (the
 * same event WP-11's quick-button row uses), so the story lands on the full
 * three-tab panel and action rows instead of the bare tab.
 */
export const Open: Story = {
  decorators: [withBuilderData],
  render: () => {
    useEffect(() => {
      window.dispatchEvent(new Event(OPEN_EVENT));
    }, []);
    return <BuilderPanel />;
  },
};
