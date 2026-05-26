import type { Meta, StoryObj } from "@storybook/react";
import { QueryErrorState } from "../src/components/QueryErrorState";

const meta: Meta<typeof QueryErrorState> = {
  title: "Components/Feedback/QueryErrorState",
  component: QueryErrorState,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof QueryErrorState>;

export const Default: Story = {
  args: {
    error: new Error("Failed to reach the backend at /api/health-checks"),
    onRetry: () => {
      // Storybook noop - wires up to a real refetch() in the app
      console.log("retry clicked");
    },
  },
};

export const WithResource: Story = {
  args: {
    error: new Error("Network request failed (504)"),
    resource: "checks",
    onRetry: () => {
      console.log("retry clicked");
    },
  },
};

export const NonErrorPayload: Story = {
  args: {
    error: null,
    onRetry: () => {
      console.log("retry clicked");
    },
  },
};
