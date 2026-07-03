import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { ChartCard, Sparkline } from "../../src/components/charts";
import { Badge } from "../../src/components/Badge";
import { sparkValues } from "./sample-data";

const meta: Meta<typeof ChartCard> = {
  title: "Charts/ChartCard",
  component: ChartCard,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof ChartCard>;

const values = sparkValues({ points: 40, base: 130, jitter: 18 });

export const HeroValue: Story = {
  render: () => (
    <div className="max-w-xl">
      <ChartCard title="Average Execution Duration" heroValue="142ms">
        <Sparkline values={values} ariaLabel="Latency over the last 40 buckets" />
      </ChartCard>
    </div>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <div className="max-w-xl">
      <ChartCard title="Status Timeline">
        <Sparkline values={values} ariaLabel="Latency over the last 40 buckets" />
      </ChartCard>
    </div>
  ),
};

export const WithActions: Story = {
  render: () => (
    <div className="max-w-xl">
      <ChartCard
        title="Average Execution Duration"
        heroValue="142ms"
        actions={<Badge variant="secondary">Expected: 120–160ms</Badge>}
      >
        <Sparkline values={values} ariaLabel="Latency over the last 40 buckets" />
      </ChartCard>
    </div>
  ),
};

export const LightAndDark: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className={`${theme} rounded-xl border bg-background p-4 text-foreground`}
        >
          <p className="mb-3 text-xs font-semibold capitalize text-muted-foreground">
            {theme}
          </p>
          <ChartCard title="Average Execution Duration" heroValue="142ms">
            <Sparkline
              values={values}
              ariaLabel="Latency over the last 40 buckets"
            />
          </ChartCard>
        </div>
      ))}
    </div>
  ),
};
