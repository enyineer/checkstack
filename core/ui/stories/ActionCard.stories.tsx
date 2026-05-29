import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ActionCard } from "../src/components/ActionCard";

const meta: Meta<typeof ActionCard> = {
  title: "Components/Automation/ActionCard",
  component: ActionCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Collapsible card that hosts a single action in the visual automation editor.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ActionCard>;

const FullFeaturedDemo = () => {
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="w-[680px] p-4">
      <ActionCard
        id="notify-1"
        title="Notify User"
        description="Send a transactional notification to a specific operator."
        category="Notification"
        icon="Bell"
        enabled={enabled}
        onEnabledChange={setEnabled}
        onDelete={() => alert("Delete clicked")}
        badges={[{ label: "produces: notify_user_result", variant: "secondary" }]}
      >
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            (DynamicForm or per-action config UI goes here.)
          </p>
          <code className="block font-mono text-xs">userId, title, body</code>
        </div>
      </ActionCard>
    </div>
  );
};

export const FullFeatured: Story = {
  render: () => <FullFeaturedDemo />,
};

export const MinimalNoToggle: Story = {
  render: () => (
    <div className="w-[680px] p-4">
      <ActionCard id="log-1" title="Log" icon="FileText">
        <p className="text-sm text-muted-foreground">
          Write a single line to the run logger.
        </p>
      </ActionCard>
    </div>
  ),
};
