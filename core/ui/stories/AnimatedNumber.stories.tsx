import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "../src/components/AnimatedNumber";

const meta: Meta<typeof AnimatedNumber> = {
  title: "Components/Display/AnimatedNumber",
  component: AnimatedNumber,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof AnimatedNumber>;

const Demo = () => {
  const [value, setValue] = useState(99.95);
  useEffect(() => {
    const id = setInterval(
      () => setValue(95 + Math.random() * 5),
      1500,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-3xl font-bold text-success tabular-nums">
      <AnimatedNumber value={value} suffix="%" decimals={2} />
    </div>
  );
};

export const Uptime: Story = { render: () => <Demo /> };

export const NA: Story = {
  args: { value: undefined },
  render: (args) => (
    <span className="text-2xl font-bold">
      <AnimatedNumber {...args} />
    </span>
  ),
};
