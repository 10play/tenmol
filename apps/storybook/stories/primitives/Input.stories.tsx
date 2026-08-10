/**
 * TextInput / TextArea — the native field primitives.
 *
 * Both are plain `<input>` / `<textarea>` in every theme, so behaviour (value,
 * selection, IME, key events) never changes; only paint moves. The classic theme
 * leaves them mostly bare, while the shadcn theme reads `data-slot` to layer a
 * modern field treatment (radius, focus ring) under `[data-ui-theme='shadcn']`.
 * Flip the toolbar Theme to compare, and Appearance for light/dark in modern.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { TextArea, TextInput } from '@web/ui';

const meta = {
  title: 'Primitives/Input',
  component: TextInput,
  parameters: { layout: 'padded' },
  args: {
    placeholder: 'Type here…',
    disabled: false,
  },
  argTypes: {
    placeholder: { control: 'text' },
    value: { control: 'text' },
    defaultValue: { control: 'text' },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Interactive single field — drive placeholder/value/disabled from Controls. */
export const Playground: Story = {
  render: (args) => <TextInput {...args} style={{ width: 260 }} />,
};

/** A labelled field with a caption, used as the building block below. */
function Field({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      {children}
      <span style={{ fontSize: 11, opacity: 0.6 }}>{caption}</span>
    </label>
  );
}

/** Resting, filled, disabled, and the command-line field, side by side. */
export const States: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20, maxWidth: 320 }}>
      <Field label="Default" caption="Empty, showing a placeholder.">
        <TextInput placeholder="e.g. render 900,700" style={{ width: 260 }} />
      </Field>

      <Field label="Filled" caption="Carries an initial value.">
        <TextInput defaultValue="900,700" style={{ width: 260 }} />
      </Field>

      <Field label="Disabled" caption="Non-interactive; value still in the DOM.">
        <TextInput defaultValue="900,700" disabled style={{ width: 260 }} />
      </Field>

      <Field label="Command line" caption="The app's cmdline__input class passes through untouched.">
        <TextInput className="cmdline__input" defaultValue="ray 900,700" style={{ width: 260 }} />
      </Field>
    </div>
  ),
};

/** Multi-line fields: a placeholder-only default and a taller pre-filled one. */
export const TextAreas: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20, maxWidth: 360 }}>
      <Field label="Default" caption="Single-line height with a placeholder.">
        <TextArea placeholder="Notes…" style={{ width: 320 }} />
      </Field>

      <Field label="Multiline" caption="Explicit rows with pre-filled content.">
        <TextArea
          rows={5}
          defaultValue={'ray 900,700\nrender out.png\n# done'}
          style={{ width: 320 }}
        />
      </Field>
    </div>
  ),
};
