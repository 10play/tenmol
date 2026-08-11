/**
 * Text Editor — the real {@link TextEditorPanel} feature bundle.
 *
 * PyMOL's `QMainWindow` text editor (`TextEditor.py:18-195`): a File menu, an
 * exclusive Syntax menu (Python / PML / Plain Text), a monospace edit surface
 * with a `<pre>` token underlay, and a status bar that names which filesystem
 * it is writing to. It renders directly from a {@link DialogWindowSpec}, so the
 * story shows its full floating-window chrome. On the stub session the bridge
 * fs probe finds no endpoint and falls back to the browser fs, exactly as
 * upstream — the modern theme's card treatment on a genuine editor window.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextEditorPanel } from '@web/features/texteditor/TextEditorPanel';
import type { DialogWindowSpec } from '@web/features/dialogs/store';

const SPEC: DialogWindowSpec = {
  key: 'texteditor:demo.pml',
  kind: 'texteditor',
  arg: 'demo.pml',
  title: 'demo.pml',
  x: 0,
  y: 0,
  width: 720,
  height: 520,
  z: 1,
  minimised: false,
};

const meta = {
  title: 'Panels/TextEditor',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TextEditorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The text editor window on an idle session, opened on a PML file. */
export const Default: Story = {
  render: () => <TextEditorPanel spec={SPEC} />,
};
