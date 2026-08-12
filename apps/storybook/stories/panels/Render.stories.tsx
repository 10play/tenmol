/**
 * Draw / Ray render dialog — the real {@link RenderDialog} feature.
 *
 * The panel is COLLAPSED by default: it lives in the `viewport` region and
 * renders only a small `Ray / Draw` tab until something opens it (Qt's one-click
 * Draw/Ray button, wired through the `render_dialog` menu hook / the
 * `tenmol:open-render` window event). A bare story would therefore show just
 * that tab. {@link Open} dispatches the open event on mount so the story lands on
 * the expanded dialog — the size-and-render setup form seeded with the reducer's
 * realistic defaults (1024×768 at 300 dpi, inches, 1.333:1 aspect locked).
 *
 * The global `withSession` decorator's stub answers every `session.call` /
 * `session.run` by resolving, so the two render buttons work end to end: the
 * {@link Result} story clicks Draw after opening, which walks the form to its
 * second page — the save-image panel with its path field, Save / Copy controls
 * and the completion status bar.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RenderDialog, OPEN_EVENT } from '@web/features/render/RenderDialog';

const meta = {
  title: 'Panels/Render',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RenderDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Find a button by its exact trimmed label inside `root`. */
function findButton(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

/**
 * Expands the collapsed dialog on mount by dispatching its open event (the same
 * event the External GUI's Draw/Ray button fires). Child effects run before this
 * parent effect, so the dialog has already registered its listener. An optional
 * `then` callback runs on the next frame — after the expand re-render commits —
 * so a story can drive the freshly mounted form (e.g. click Draw to reach the
 * result page).
 */
function Open({
  then,
  children,
}: {
  then?: (root: HTMLElement) => void;
  children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.dispatchEvent(new Event(OPEN_EVENT));
    if (then) {
      requestAnimationFrame(() => {
        if (ref.current) then(ref.current);
      });
    }
  }, [then]);
  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 12,
        minHeight: 360,
      }}
    >
      {children}
    </div>
  );
}

/** The size-and-render setup page, seeded with the form's realistic defaults. */
export const Default: Story = {
  render: () => (
    <Open>
      <RenderDialog />
    </Open>
  ),
};

/** The save page after a Draw render — path field, Save / Copy, status bar. */
export const Result: Story = {
  render: () => (
    <Open then={(root) => findButton(root, 'Draw')?.click()}>
      <RenderDialog />
    </Open>
  ),
};
