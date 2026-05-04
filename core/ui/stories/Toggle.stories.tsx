import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Toggle } from "../src/components/Toggle";

const meta: Meta<typeof Toggle> = {
  title: "Components/Inputs/Toggle",
  component: Toggle,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Toggle>;

const InteractiveToggle = () => {
  const [checked, setChecked] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Toggle
        checked={checked}
        onCheckedChange={setChecked}
        aria-label="Enable feature"
      />
      <span className="text-sm">{checked ? "Enabled" : "Disabled"}</span>
    </div>
  );
};

export const Interactive: Story = {
  render: () => <InteractiveToggle />,
};

export const Disabled: Story = {
  render: () => (
    <Toggle
      checked
      disabled
      onCheckedChange={() => {
        /* readonly */
      }}
      aria-label="Read-only toggle"
    />
  ),
};
