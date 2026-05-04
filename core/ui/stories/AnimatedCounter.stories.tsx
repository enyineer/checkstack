import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import { AnimatedCounter } from "../src/components/AnimatedCounter";

const meta: Meta<typeof AnimatedCounter> = {
  title: "Components/Display/AnimatedCounter",
  component: AnimatedCounter,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof AnimatedCounter>;

const Demo = () => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setValue((v) => (v >= 1000 ? 0 : v + Math.floor(Math.random() * 200))),
      1500,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-4xl font-bold">
      <AnimatedCounter value={value} />
    </div>
  );
};

export const TickingUp: Story = {
  render: () => <Demo />,
};

export const StaticValue: Story = {
  args: { value: 1042 },
  render: (args) => (
    <span className="text-3xl font-bold">
      <AnimatedCounter {...args} />
    </span>
  ),
};
