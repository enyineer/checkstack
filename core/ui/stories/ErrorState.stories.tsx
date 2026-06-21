import type { Meta, StoryObj } from "@storybook/react";
import { ErrorState } from "../src/components/ErrorState";

const meta: Meta<typeof ErrorState> = {
  title: "Components/Feedback/ErrorState",
  component: ErrorState,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
  args: {
    title: "Could not load systems",
    description: "The backend returned a 504 while fetching the fleet.",
    onRetry: () => {
      console.log("retry clicked");
    },
  },
};

export const WithoutRetry: Story = {
  args: {
    title: "Access denied",
    description: "You do not have permission to view this resource.",
  },
};

export const ChartFootprint: Story = {
  args: {
    title: "Latency series unavailable",
    description: "Retry to reload the chart.",
    footprint: "chart",
    onRetry: () => {
      console.log("retry clicked");
    },
  },
};
