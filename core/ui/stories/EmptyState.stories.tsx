import type { Meta, StoryObj } from "@storybook/react";
import { Inbox } from "lucide-react";
import { EmptyState } from "../src/components/EmptyState";
import { Button } from "../src/components/Button";

const meta: Meta<typeof EmptyState> = {
  title: "Components/Feedback/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Simple: Story = {
  args: {
    title: "No systems yet",
    description: "Add your first system to start monitoring it.",
    icon: <Inbox className="size-8" />,
  },
};

export const ChartFootprint: Story = {
  args: {
    title: "No data in range",
    description: "Widen the time range to see latency.",
    icon: <Inbox className="size-8" />,
    footprint: "chart",
  },
};

export const Coaching: Story = {
  args: {
    title: "Get started with health checks",
    description: "Three quick steps to your first monitored endpoint.",
    icon: <Inbox className="size-8" />,
    steps: ["Create a system", "Add an HTTP check", "Set the SLO target"],
    actions: <Button variant="primary">Create your first check</Button>,
  },
};
