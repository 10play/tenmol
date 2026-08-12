/**
 * Sequence viewer — the real {@link SequenceViewer} feature ("Seeker").
 *
 * PyMOL draws this strip INSIDE the GL viewport and it renders nothing at all
 * until an enabled object has `seq_view` on, so the bare mock session shows a
 * blank. {@link withSeqviewData} seeds a populated two-chain window (H-Ras and a
 * c-Raf fragment) of one-letter residue codes with residue-number labels, chain
 * breadcrumbs, per-residue-class colouring and a live P-loop selection, and the
 * strip is mounted in a relative stage that stands in for `.shell__viewport`
 * (the strip is `position: absolute` and needs a positioned offset parent).
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { SequenceViewer } from '@web/features/seqview/SequenceViewer';
import { withSeqviewData } from './seqviewSession';

const meta = {
  title: 'Panels/Sequence',
  parameters: { layout: 'padded' },
  decorators: [withSeqviewData],
} satisfies Meta<typeof SequenceViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The stand-in viewport: a rounded, bordered stage with a relative position so
 * the absolutely-positioned strip pins to its top edge, exactly as it pins to
 * the top of the GL viewport in the app.
 */
function Stage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        height: 320,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--sh-line-strong, rgba(148,163,184,0.2))',
        background:
          'radial-gradient(120% 80% at 50% -10%, rgba(99,102,241,0.16), transparent 60%), var(--pm-bg-viewport, #0b0d12)',
      }}
    >
      {children}
    </div>
  );
}

/** The residue strip on a populated two-chain window. */
export const Default: Story = {
  render: () => (
    <Stage>
      <SequenceViewer />
    </Stage>
  ),
};
