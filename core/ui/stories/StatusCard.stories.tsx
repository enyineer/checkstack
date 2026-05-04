import type { Meta, StoryObj } from "@storybook/react";
import { TrendingUp } from "lucide-react";
import { StatusCard } from "../src/components/StatusCard";

const meta: Meta<typeof StatusCard> = {
  title: "Components/Display/StatusCard",
  component: StatusCard,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StatusCard>;

export const Default: Story = {
  args: {
    title: "Uptime",
    value: "99.95%",
    description: "Last 30 days",
    icon: <TrendingUp className="h-5 w-5" />,
  },
};

export const Gradient: Story = {
  args: {
    title: "Throughput",
    value: "1.2k req/s",
    icon: <TrendingUp className="h-5 w-5" />,
    variant: "gradient",
  },
};
