import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "../src/components/Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Components/Overlays/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Hover: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="text-sm">Probe interval</span>
      <Tooltip content="How frequently this check runs against its target." />
    </div>
  ),
};
