import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ColorPicker } from "../src/components/ColorPicker";

const meta: Meta<typeof ColorPicker> = {
  title: "Components/Inputs/ColorPicker",
  component: ColorPicker,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ColorPicker>;

const Demo = () => {
  const [color, setColor] = useState("#7c3aed");
  return (
    <div className="space-y-3 max-w-sm">
      <ColorPicker value={color} onChange={setColor} />
      <p className="text-sm text-muted-foreground">Selected: <code>{color}</code></p>
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
