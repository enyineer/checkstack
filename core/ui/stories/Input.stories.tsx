import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "../src/components/Input";
import { Label } from "../src/components/Label";

const meta: Meta<typeof Input> = {
  title: "Components/Inputs/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    placeholder: "Enter a value",
    type: "text",
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true, value: "Cannot edit" } };

export const WithLabel: Story = {
  render: (args) => (
    <div className="space-y-2 max-w-sm">
      <Label htmlFor="endpoint">API endpoint</Label>
      <Input id="endpoint" {...args} placeholder="https://api.example.com" />
    </div>
  ),
};
