/**
 * Dialog Form — a modal composed from primitives.
 *
 * A Radix-backed `Dialog` wrapping a small form (a `TextInput`, a `Select`, a
 * labelled `Checkbox`) and a footer of `DialogClose`-driven buttons. The overlay
 * and panel are portalled and painted by the modern theme; flip the toolbar
 * Theme to compare classic/shadcn, and Appearance for light/dark.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Select,
  TextInput,
} from '@web/ui';

const meta = {
  title: 'Bundles/Dialog Form',
  component: Dialog,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shared body: title, description, the uncontrolled form, and a close footer. */
function DialogFormContent() {
  return (
    <DialogContent>
      <DialogTitle>New scene</DialogTitle>
      <DialogDescription>Name the scene and pick a starting template.</DialogDescription>

      <form
        style={{ display: 'grid', gap: 12 }}
        onSubmit={(event) => event.preventDefault()}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ opacity: 0.7 }}>Scene name</span>
          <TextInput name="scene" defaultValue="Untitled" placeholder="Scene name" />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ opacity: 0.7 }}>Template</span>
          <Select name="template" defaultValue="blank">
            <option value="blank">Blank</option>
            <option value="grid">Grid</option>
            <option value="studio">Studio</option>
          </Select>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Checkbox name="open" defaultChecked />
          <span>Open after creating</span>
        </label>
      </form>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <DialogClose asChild>
          <Button variant="extgui">Save</Button>
        </DialogClose>
        <DialogClose>Cancel</DialogClose>
      </div>
    </DialogContent>
  );
}

/** Opens on load via `defaultOpen`, so the composed form is visible immediately. */
export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogFormContent />
    </Dialog>
  ),
};

/** Closed at rest; a `DialogTrigger asChild` button opens the same form. */
export const Triggered: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="extgui">Open form</Button>
      </DialogTrigger>
      <DialogFormContent />
    </Dialog>
  ),
};
