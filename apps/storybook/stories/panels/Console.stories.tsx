/**
 * External GUI console — the real {@link ConsolePanel} feature bundle and its
 * three parts.
 *
 * PyMOL's dock widget (`pymol_qt_gui.py:118-284`): the scrollback output pane
 * ({@link FeedbackLog}), the `PyMOL>` command line ({@link CommandLine}), and
 * the 4-row grid of quick buttons over a progress row ({@link QuickButtons}).
 * `ConsolePanel` composes all three and also mounts the in-viewport
 * `OrthoConsole`; in isolation that overlay portals onto a viewport that is not
 * present in the story, so it stays dormant and the dock chrome is what shows.
 * Mounted on the stub session; the output stories seed its feedback ring with a
 * real startup + `fetch 1ubq` transcript so the modern theme's card treatment
 * shows on a genuine, connected console rather than an empty ring.
 */

import { useEffect, type ReactNode } from 'react';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { useSession } from '@web/app';
import { ConsolePanel } from '@web/features/console/ConsolePanel';
import { CommandLine } from '@web/features/console/CommandLine';
import { FeedbackLog } from '@web/features/console/FeedbackLog';
import { QuickButtons } from '@web/features/console/QuickButtons';

/**
 * A slice of real PyMOL startup + `fetch 1ubq` scrollback (severities inferred
 * exactly as the store does at runtime): banner lines, a `PyMOL>` prompt echo,
 * a warning, and a ray-trace timing row. Without it the output pane is a true
 * but featureless empty ring — seeding it shows the modern console treatment
 * doing its actual job.
 */
const SAMPLE_FEEDBACK = [
  ' Detected OpenGL version 4.6. Shaders available.',
  ' Detected GLSL version 4.60.',
  ' OpenVR system not detected.',
  'PyMOL>fetch 1ubq, async=0',
  ' ExecutiveLoad-Detail: Detected mmCIF',
  ' ObjectMolecule: Read secondary structure assignments.',
  ' ObjectMolecule: Read crystal symmetry information.',
  ' Symmetry: Found 4 symmetry operators.',
  ' CmdLoad: "1ubq.cif" loaded as "1ubq".',
  'PyMOL>hide everything',
  'PyMOL>show cartoon',
  'PyMOL>spectrum count, rainbow',
  ' Executive: coloring 602 atoms.',
  ' Setting-Warning: ray_trace_mode is not supported by this build.',
  ' Ray: render time 0.42 sec = 2.4 fps.',
  ' ScenePNG: wrote 1280x960 pixel image to "render.png".',
];

/** Seeds the shared stub session's feedback ring once so the pane has content. */
function SeedFeedback({ children }: { children: ReactNode }) {
  const session = useSession();
  useEffect(() => {
    if (session.stores.feedback.get().lines.length === 0) {
      session.stores.feedback.appendServer(SAMPLE_FEEDBACK);
    }
  }, [session]);
  return <>{children}</>;
}

const withFeedbackData: Decorator = (Story) => (
  <SeedFeedback>
    <Story />
  </SeedFeedback>
);

const meta = {
  title: 'Panels/Console',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ConsolePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full console dock — output pane, command line, and quick buttons. */
export const Default: Story = {
  decorators: [withFeedbackData],
  render: () => <ConsolePanel />,
};

/** The scrollback output pane, seeded with a real startup + fetch transcript. */
export const Feedback: Story = {
  decorators: [withFeedbackData],
  render: () => <FeedbackLog />,
};

/** Just the `PyMOL>` command line with its history and completion. */
export const Command: Story = {
  render: () => <CommandLine />,
};

/** Just the 4-row quick-button grid and its progress row. */
export const Quick: Story = {
  render: () => <QuickButtons />,
};
