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

/**
 * Home-Assistant-style collapsed summary row. Passing `onOpenSheet` makes the
 * card a non-expanding summary: clicking the header opens the item's full
 * config in a side sheet (wired up by the host) instead of expanding inline.
 * `summary` renders a compact one-line hint under the title, and `actions`
 * adds a three-dot overflow menu (Duplicate / Disable / Delete).
 */
const CollapsedSummaryDemo = () => {
  const [enabled, setEnabled] = useState(true);
  return (
    <div className="w-[680px] space-y-2 p-4">
      <ActionCard
        id="notify-1"
        title="Notify User"
        category="Notification"
        icon="Bell"
        summary="notify_user → on-call engineer"
        enabled={enabled}
        onOpenSheet={() => alert("Open config sheet")}
        actions={[
          {
            label: enabled ? "Disable" : "Enable",
            icon: enabled ? "PowerOff" : "Power",
            onClick: () => setEnabled((value) => !value),
          },
          { label: "Duplicate", icon: "Copy", onClick: () => alert("Duplicate") },
          {
            label: "Delete",
            icon: "Trash2",
            onClick: () => alert("Delete"),
            variant: "destructive",
          },
        ]}
      />
      <ActionCard
        id="choose-1"
        title="Choose (if / else)"
        category="Choose"
        icon="GitBranch"
        summary="2 branches + else"
        onOpenSheet={() => alert("Open config sheet")}
        errors={["choose.0.when: condition is required"]}
        actions={[
          { label: "Duplicate", icon: "Copy", onClick: () => alert("Duplicate") },
          {
            label: "Delete",
            icon: "Trash2",
            onClick: () => alert("Delete"),
            variant: "destructive",
          },
        ]}
      />
    </div>
  );
};

export const CollapsedSummary: Story = {
  render: () => <CollapsedSummaryDemo />,
};
