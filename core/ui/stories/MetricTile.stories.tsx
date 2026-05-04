import type { Meta, StoryObj } from "@storybook/react";
import { Activity, Cpu, MemoryStick, Network } from "lucide-react";
import { MetricTile } from "../src/components/MetricTile";

const meta: Meta<typeof MetricTile> = {
  title: "Components/Display/MetricTile",
  component: MetricTile,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MetricTile>;

export const Single: Story = {
  args: {
    icon: Activity,
    label: "Throughput",
    value: "1.2k req/s",
  },
};

export const Grid: Story = {
  render: () => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl">
      <MetricTile icon={Cpu} label="CPU" value="42%" subtitle="across 4 cores" />
      <MetricTile icon={MemoryStick} label="Memory" value="3.1 GB" variant="warning" />
      <MetricTile icon={Network} label="Network" value="220 Mbps" variant="success" />
      <MetricTile icon={Activity} label="Errors" value="14" variant="destructive" />
    </div>
  ),
};
