import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Slider } from "../src/components/Slider";

const meta: Meta<typeof Slider> = {
  title: "Components/Inputs/Slider",
  component: Slider,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Slider>;

const Demo = () => {
  const [value, setValue] = useState([60]);
  return (
    <div className="max-w-md space-y-3">
      <Slider value={value} onValueChange={setValue} min={0} max={100} step={1} />
      <p className="text-sm text-muted-foreground">Value: {value[0]}</p>
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
