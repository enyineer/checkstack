import type { Meta, StoryObj } from "@storybook/react";
import { TerminalFeed, type TerminalEntry } from "../src/components/TerminalFeed";

const meta: Meta<typeof TerminalFeed> = {
  title: "Components/Display/TerminalFeed",
  component: TerminalFeed,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TerminalFeed>;

const entries: TerminalEntry[] = [
  {
    id: "1",
    timestamp: new Date(),
    content: "Probe started for api.checkstack.io",
    variant: "info",
  },
  {
    id: "2",
    timestamp: new Date(),
    content: "200 OK in 42ms",
    variant: "success",
  },
  {
    id: "3",
    timestamp: new Date(),
    content: "Latency exceeds SLO threshold",
    variant: "warning",
    suffix: "p99 > 300ms",
  },
  {
    id: "4",
    timestamp: new Date(),
    content: "Probe failed: connection refused",
    variant: "error",
  },
];

export const Default: Story = {
  args: {
    entries,
    title: "Probe activity",
    maxHeight: "300px",
  },
};
