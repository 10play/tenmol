/**
 * Text Editor — the real {@link TextEditorPanel} feature bundle.
 *
 * PyMOL's `QMainWindow` text editor (`TextEditor.py:18-195`): a File menu, an
 * exclusive Syntax menu (Python / PML / Plain Text), a monospace edit surface
 * with a `<pre>` token underlay, and a status bar that names which filesystem
 * it is writing to. It renders directly from a {@link DialogWindowSpec}, so the
 * story shows its full floating-window chrome.
 *
 * {@link withTextEditorData} stands in for a bridge with the WP-18 files service
 * installed, so the editor opens POPULATED — a real script with every syntax
 * token lit, the `bridge fs` badge, and an active Run button — instead of the
 * blank browser-fallback buffer the bare stub draws.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextEditorPanel } from '@web/features/texteditor/TextEditorPanel';
import type { DialogWindowSpec } from '@web/features/dialogs/store';

import { withTextEditorData } from './textEditorSession';

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
  decorators: [withTextEditorData],
} satisfies Meta<typeof TextEditorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The editor opened on a PML render script, served by the bridge filesystem. */
export const Default: Story = {
  render: () => <TextEditorPanel spec={SPEC} />,
};

/**
 * `File ▸ Edit pymolrc`: the editor resolves `@pymolrc` to the machine's active
 * rc file, shows the "read at startup — restart to apply" note, and — because
 * two rc files are active — offers the chooser Qt raises with `QInputDialog`.
 */
export const Pymolrc: Story = {
  render: () => (
    <TextEditorPanel
      spec={{
        ...SPEC,
        key: 'texteditor:@pymolrc',
        arg: '@pymolrc',
        title: '~/.pymolrc',
      }}
    />
  ),
};
