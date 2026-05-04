import type { Meta, StoryObj } from "@storybook/react";
import { Label } from "../src/components/Label";
import { Textarea } from "../src/components/Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Components/Inputs/Textarea",
  component: Textarea,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: "Describe what changed…", rows: 4 },
};

export const WithLabel: Story = {
  render: () => (
    <div className="space-y-2 max-w-md">
      <Label htmlFor="notes">Notes</Label>
      <Textarea id="notes" rows={5} placeholder="Optional context…" />
    </div>
  ),
};
