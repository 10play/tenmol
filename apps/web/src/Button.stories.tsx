import type { Meta, StoryObj } from "@storybook/react";

// A trivial placeholder story — real component stories can be added later.
function PlaceholderButton({ label }: { label: string }) {
  return <button style={{ padding: "8px 16px" }}>{label}</button>;
}

const meta = {
  title: "Placeholder/Button",
  component: PlaceholderButton,
} satisfies Meta<typeof PlaceholderButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Hello Storybook" },
};
