import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { SplitPane } from "../src/components/SplitPane";
import { Card, CardContent, CardHeader, CardTitle } from "../src/components/Card";
import { EmptyState } from "../src/components/EmptyState";
import { Inbox } from "lucide-react";

const meta: Meta<typeof SplitPane> = {
  title: "Components/Layout/SplitPane",
  component: SplitPane,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof SplitPane>;

const items = Array.from({ length: 40 }, (_, i) => ({
  id: `item-${i}`,
  title: `Run #${1000 - i}`,
  detail: `Details for run #${1000 - i}: latency ${90 + ((i * 13) % 80)}ms, all assertions passed.`,
}));

const MasterDetailDemo: React.FC<{ masterWidth?: "1/3" | "2/5" | "1/2" }> = ({
  masterWidth,
}) => {
  const [selectedId, setSelectedId] = useState<string | undefined>(items[2]?.id);
  const selected = items.find((i) => i.id === selectedId);
  return (
    <div className="p-4">
      <SplitPane
        masterWidth={masterWidth}
        className="md:h-[28rem]"
        master={
          <ul className="space-y-1 pr-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-current={item.id === selectedId ? "true" : undefined}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    item.id === selectedId ? "bg-surface-inset font-medium" : ""
                  }`}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        }
        detail={
          selected ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{selected.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {selected.detail}
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<Inbox className="h-10 w-10" />}
              title="Nothing selected"
              description="Select an item on the left to inspect it."
            />
          )
        }
      />
    </div>
  );
};

export const Default: Story = { render: () => <MasterDetailDemo /> };

export const NarrowMaster: Story = {
  render: () => <MasterDetailDemo masterWidth="1/3" />,
};

export const EvenSplit: Story = {
  render: () => <MasterDetailDemo masterWidth="1/2" />,
};
