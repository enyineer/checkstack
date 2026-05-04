import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Checkbox } from "../src/components/Checkbox";
import { Label } from "../src/components/Label";

const meta: Meta<typeof Checkbox> = {
  title: "Components/Inputs/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

const Interactive = () => {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="cb"
        checked={checked}
        onCheckedChange={setChecked}
      />
      <Label htmlFor="cb">I agree</Label>
    </div>
  );
};

export const Default: Story = { render: () => <Interactive /> };

export const Disabled: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox
        id="cb-d"
        checked
        disabled
        onChange={() => {
          /* noop */
        }}
      />
      <Label htmlFor="cb-d">Disabled (checked)</Label>
    </div>
  ),
};
