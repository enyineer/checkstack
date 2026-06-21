import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "../src/components/Input";
import { Label } from "../src/components/Label";
import { FormError } from "../src/components/FormError";

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

// `invalid` applies destructive border/ring styling and sets `aria-invalid`.
// Pair with a FormError wired via `aria-describedby` for assistive tech.
export const Invalid: Story = {
  render: () => (
    <div className="space-y-2 max-w-sm">
      <Label htmlFor="endpoint-invalid" required>
        API endpoint
      </Label>
      <Input
        id="endpoint-invalid"
        invalid
        aria-describedby="endpoint-invalid-error"
        defaultValue="not-a-url"
      />
      <FormError id="endpoint-invalid-error">
        Enter a valid https URL.
      </FormError>
    </div>
  ),
};
