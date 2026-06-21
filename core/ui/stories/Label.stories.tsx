import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "../src/components/Input";
import { Label } from "../src/components/Label";

const meta: Meta<typeof Label> = {
  title: "Components/Inputs/Label",
  component: Label,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = {
  render: () => (
    <div className="space-y-2 max-w-sm">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};

// `required` renders a token-colored `*` (hidden from AT) plus an sr-only
// "(required)" so the requirement is not conveyed by color alone.
export const Required: Story = {
  render: () => (
    <div className="space-y-2 max-w-sm">
      <Label htmlFor="email-required" required>
        Email
      </Label>
      <Input id="email-required" type="email" placeholder="you@example.com" />
    </div>
  ),
};
