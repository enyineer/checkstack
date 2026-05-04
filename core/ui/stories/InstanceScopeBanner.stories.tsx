import type { Meta, StoryObj } from "@storybook/react";
import { InstanceScopeBanner } from "../src/components/InstanceScopeBanner";

const meta: Meta<typeof InstanceScopeBanner> = {
  title: "Components/Feedback/InstanceScopeBanner",
  component: InstanceScopeBanner,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof InstanceScopeBanner>;

export const InstanceScope: Story = {
  args: {
    scope: "instance",
    subject: "Queue",
    recommendation: "Switch to a Redis-backed queue to see cluster-wide totals.",
  },
};

export const ClusterScope: Story = {
  args: {
    scope: "cluster",
    subject: "Queue",
    recommendation: "Banner is hidden when scope is 'cluster'.",
  },
  render: (args) => (
    <div>
      <InstanceScopeBanner {...args} />
      <p className="text-sm text-muted-foreground">
        Renders nothing — confirm by inspecting the DOM.
      </p>
    </div>
  ),
};
