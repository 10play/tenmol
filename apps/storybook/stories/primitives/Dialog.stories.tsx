/**
 * Dialog — the Radix/shadcn modal primitive (`ui/Dialog`).
 *
 * `DialogContent` portals a centred panel over a dark overlay and ships its own
 * close (X); `DialogTitle`/`DialogDescription` label it for screen readers.
 * Trigger and close controls use `asChild` to borrow a `<Button>` as the DOM.
 * Flip the toolbar Theme to compare classic vs. modern, Appearance for dark/light.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@web/ui';

const meta = {
  title: 'Primitives/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shared modal body: title, description, a paragraph and close actions. */
function DialogBody() {
  return (
    <DialogContent>
      <DialogTitle>Rename session</DialogTitle>
      <DialogDescription>
        Give this session a memorable name so you can find it later.
      </DialogDescription>
      <p style={{ marginBottom: 16 }}>
        The name is only stored locally and can be changed at any time from the
        session menu.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <DialogClose asChild>
          <Button variant="bare">Cancel</Button>
        </DialogClose>
        <DialogClose asChild>
          <Button variant="extgui">Done</Button>
        </DialogClose>
      </div>
    </DialogContent>
  );
}

/**
 * Opens on load via `defaultOpen`, so the modal and its overlay cover the canvas
 * immediately — expected here. Dismiss with the X, Cancel, Done, or Esc.
 */
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogBody />
    </Dialog>
  ),
};

/**
 * Closed at rest: a `DialogTrigger asChild` wraps a `<Button variant="extgui">`,
 * and clicking it mounts the same content.
 */
export const Triggered: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="extgui">Open dialog</Button>
      </DialogTrigger>
      <DialogBody />
    </Dialog>
  ),
};
