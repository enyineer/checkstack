import type { Meta, StoryObj } from "@storybook/react";
import { Inbox } from "lucide-react";
import { Button } from "../src/components/Button";
import { EmptyState } from "../src/components/EmptyState";
import { HealthBadge } from "../src/components/HealthBadge";
import { LoadingSpinner } from "../src/components/LoadingSpinner";

const meta: Meta = {
  title: "Components/Feedback/Status & Empty",
};

export default meta;

type Story = StoryObj;

export const HealthBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <HealthBadge status="healthy" />
      <HealthBadge status="degraded" />
      <HealthBadge status="unhealthy" />
      <HealthBadge status="healthy" variant="compact" />
    </div>
  ),
};

export const Spinner: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <LoadingSpinner />
      <span className="text-sm text-muted-foreground">Loading…</span>
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <EmptyState
      title="No health checks yet"
      description="Plugins can register checks at runtime. Create one to see it here."
      icon={<Inbox className="h-10 w-10" />}
      actions={<Button>Create check</Button>}
    />
  ),
};
