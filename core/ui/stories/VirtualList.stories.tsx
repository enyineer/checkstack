import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { VirtualList } from "../src/components/VirtualList";

const meta: Meta<typeof VirtualList> = {
  title: "Components/Layout/VirtualList",
  component: VirtualList,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof VirtualList>;

interface Row {
  id: string;
  label: string;
  tall: boolean;
}

const rows: Row[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `row-${i}`,
  label: `Row ${i + 1}`,
  tall: i % 7 === 0,
}));

export const FiveThousandRows: Story = {
  render: () => (
    <VirtualList
      items={rows}
      getKey={({ item }) => item.id}
      estimateSize={({ item }) => (item.tall ? 64 : 40)}
      className="h-96 max-w-md rounded-md border"
      renderItem={({ item, index }) => (
        <div
          className={`flex items-center border-b border-border/60 px-3 text-sm ${
            item.tall ? "h-16 bg-surface-inset/50" : "h-10"
          }`}
        >
          <span className="text-muted-foreground tabular-nums">
            #{index + 1}
          </span>
          <span className="ml-3">{item.label}</span>
        </div>
      )}
    />
  ),
};

const ScrollToDemo: React.FC = () => {
  const [target, setTarget] = useState(2500);
  return (
    <div className="max-w-md space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="rounded-md border px-3 py-1 hover:bg-surface-inset"
          onClick={() => setTarget(Math.floor(Math.random() * rows.length))}
        >
          Scroll to a random row
        </button>
        <span className="text-muted-foreground">target: #{target + 1}</span>
      </div>
      <VirtualList
        items={rows}
        getKey={({ item }) => item.id}
        estimateSize={() => 40}
        scrollToIndex={target}
        className="h-96 rounded-md border"
        renderItem={({ item, index }) => (
          <div
            className={`flex h-10 items-center border-b border-border/60 px-3 text-sm ${
              index === target ? "bg-surface-inset font-medium" : ""
            }`}
          >
            {item.label}
          </div>
        )}
      />
    </div>
  );
};

export const ScrollToIndex: Story = { render: () => <ScrollToDemo /> };
