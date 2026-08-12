/**
 * File menu — the real {@link FilesPanel} feature bundle.
 *
 * Parity area 6's overlay: a compact "File ▾" launcher strip carrying the
 * toolkit-independent PyMOL File menu (`_gui.py:80-133`), and the orchestrator
 * that drives the open/save/render dialogs behind it. Entries with no
 * single-process web analogue (New PyMOL Window) are shown disabled with their
 * reason rather than dropped.
 *
 * On the bare stub every dialog is hollow: each menu item is gated on
 * `api.ensure()`, which the stub answers with a falsy `hello`, so nothing opens.
 * These stories mount the panel on {@link withFilesData} — a session that
 * answers the `cmd.tenmol_files.*` calls the way a connected engine with a few
 * structures loaded would — and use {@link openFilesDialog}/{@link openFilesMenu}
 * to show the surfaces the panel exists to host, POPULATED.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { FilesPanel } from '@web/features/files/FilesPanel';
import { withFilesData, openFilesDialog, openFilesMenu } from './filesSession';

const meta = {
  title: 'Panels/Files',
  parameters: { layout: 'padded' },
  decorators: [withFilesData],
} satisfies Meta<typeof FilesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Get PDB — the fetch form: banner, PDB-ID field, options fieldset, live command preview. */
export const Default: Story = {
  render: () => <FilesPanel />,
  decorators: [openFilesDialog('fetch')],
};

/** The File dropdown open, showing the full menu (geometry exports and all). */
export const Menu: Story = {
  render: () => <FilesPanel />,
  decorators: [openFilesMenu],
};

/** Export Molecule — selection combo, state picker, tabbed options and checkboxes. */
export const ExportMolecule: Story = {
  render: () => <FilesPanel />,
  decorators: [openFilesDialog('export-molecule')],
};

/** Open Recent — the `~/.pymol/recent.db` list, one row already missing. */
export const Recent: Story = {
  render: () => <FilesPanel />,
  decorators: [openFilesDialog('recent')],
};

/** Log File — the command-logging hub, shown with a `.pml` log already open. */
export const LogFile: Story = {
  render: () => <FilesPanel />,
  decorators: [openFilesDialog('log')],
};
