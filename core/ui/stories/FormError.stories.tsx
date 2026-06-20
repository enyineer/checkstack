import type { Meta, StoryObj } from "@storybook/react";
import { FormError } from "../src/components/FormError";
import { Input } from "../src/components/Input";
import { Label } from "../src/components/Label";

const meta: Meta<typeof FormError> = {
  title: "Components/Forms/FormError",
  component: FormError,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof FormError>;

export const Default: Story = {
  render: () => <FormError>This field is required.</FormError>,
};

// Renders nothing when there is no message, so callers can pass a
// possibly-undefined error without a surrounding conditional.
export const Empty: Story = {
  render: () => (
    <div>
      <FormError>{undefined}</FormError>
      <span className="text-sm text-muted-foreground">(no error shown)</span>
    </div>
  ),
};

// Canonical wiring: input -> error via `aria-describedby`, `role="alert"`.
export const WiredToField: Story = {
  render: () => (
    <div className="space-y-2 max-w-sm">
      <Label htmlFor="port" required>
        Port
      </Label>
      <Input id="port" invalid aria-describedby="port-error" defaultValue="-1" />
      <FormError id="port-error">Port must be between 1 and 65535.</FormError>
    </div>
  ),
};
