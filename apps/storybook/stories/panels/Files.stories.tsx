/**
 * File menu — the real {@link FilesPanel} feature bundle.
 *
 * Parity area 6's overlay: a compact "File ▾" launcher strip carrying the
 * toolkit-independent PyMOL File menu (`_gui.py:80-133`), and the orchestrator
 * that drives the open/save/render dialogs behind it. Entries with no
 * single-process web analogue (New PyMOL Window) are shown disabled with their
 * reason rather than dropped. Mounted on the stub session — which classifies
 * nothing and lists no recent files — so the strip renders its idle chrome:
 * the modern theme's floating-card treatment on a genuine, connected launcher.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilesPanel } from '@web/features/files/FilesPanel';

const meta = {
  title: 'Panels/Files',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FilesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The File launcher strip at rest on an idle session. */
export const Default: Story = {
  render: () => <FilesPanel />,
};
