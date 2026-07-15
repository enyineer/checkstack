import type { Meta, StoryObj } from "@storybook/react";
import { CollapsibleDetailCard } from "../src/components/CollapsibleDetailCard";
import { Network, ScrollText } from "lucide-react";

const meta: Meta<typeof CollapsibleDetailCard> = {
  title: "Components/Display/CollapsibleDetailCard",
  component: CollapsibleDetailCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The canonical collapsible system-overview card: a `DetailCard` whose header doubles as an expand/collapse toggle (icon + title + optional count + rotating chevron). Single-sources the header layout so every collapsible card (Dependencies, Logs / Metrics / Traces, ...) is vertically centred and behaves identically. The chevron transition is gated on `usePerformance().isLowPower`.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof CollapsibleDetailCard>;

export const Collapsed: Story = {
  render: () => (
    <div className="max-w-md">
      <CollapsibleDetailCard icon={ScrollText} title="Logs" count={2}>
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {["checkout-api", "payments-worker"].map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{name}</span>
            </li>
          ))}
        </ul>
      </CollapsibleDetailCard>
    </div>
  ),
};

export const Expanded: Story = {
  render: () => (
    <div className="max-w-md">
      <CollapsibleDetailCard
        icon={ScrollText}
        title="Logs"
        count={2}
        defaultExpanded
      >
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {["checkout-api", "payments-worker"].map((name) => (
            <li
              key={name}
              className="flex items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{name}</span>
            </li>
          ))}
        </ul>
      </CollapsibleDetailCard>
    </div>
  ),
};

export const NonCollapsibleEmptyState: Story = {
  name: "Non-collapsible (empty state)",
  render: () => (
    <div className="max-w-md">
      <CollapsibleDetailCard
        icon={Network}
        title="Dependencies"
        collapsible={false}
        bodyClassName="px-[var(--d-pad)] pb-[var(--d-pad)]"
      >
        <p className="text-sm text-muted-foreground">
          This system has no recorded dependencies.
        </p>
      </CollapsibleDetailCard>
    </div>
  ),
};
