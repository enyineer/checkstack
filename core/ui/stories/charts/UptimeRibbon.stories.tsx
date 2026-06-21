import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { UptimeRibbon } from "../../src/components/charts";
import { uptimeCells } from "./sample-data";

const meta: Meta<typeof UptimeRibbon> = {
  title: "Charts/UptimeRibbon",
  component: UptimeRibbon,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof UptimeRibbon>;

const cells90 = uptimeCells({ days: 90 });

export const NinetyDays: Story = {
  render: () => (
    <div className="max-w-xl">
      <UptimeRibbon cells={cells90} height={36} />
    </div>
  ),
};

export const PerRunCompact: Story = {
  render: () => (
    <div className="max-w-md">
      <UptimeRibbon cells={uptimeCells({ days: 40, seed: 9 })} height={24} />
    </div>
  ),
};

export const WithUnknownTail: Story = {
  render: () => {
    const cells = uptimeCells({ days: 60 }).map((c, i) =>
      i >= 54 ? { ...c, status: "unknown" as const } : c,
    );
    return (
      <div className="max-w-xl">
        <UptimeRibbon cells={cells} height={36} />
      </div>
    );
  },
};

export const LightAndDark: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className={`${theme} rounded-xl border bg-surface p-4 text-foreground`}
        >
          <p className="mb-3 text-xs font-semibold capitalize text-muted-foreground">
            {theme}
          </p>
          <UptimeRibbon cells={cells90} height={36} />
        </div>
      ))}
    </div>
  ),
};
