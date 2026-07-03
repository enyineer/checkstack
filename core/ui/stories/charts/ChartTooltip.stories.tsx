import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { ChartTooltip } from "../../src/components/charts";

const meta: Meta<typeof ChartTooltip> = {
  title: "Charts/ChartTooltip",
  component: ChartTooltip,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof ChartTooltip>;

export const StatusBucket: Story = {
  args: {
    title: "Apr 3, 14:00 – 15:00",
    rows: [
      { id: "ok", label: "Healthy", value: "58", tone: "ok" },
      { id: "warn", label: "Degraded", value: "3", tone: "warn" },
      { id: "down", label: "Unhealthy", value: "1", tone: "down" },
    ],
    footer: "62 runs",
  },
};

export const SingleMetric: Story = {
  args: {
    title: "Apr 3, 14:20",
    rows: [{ id: "p50", label: "p50 latency", value: "142 ms", tone: "primary" }],
  },
};

export const NoTitle: Story = {
  args: {
    rows: [
      { id: "pass", label: "Passed", value: "97%", tone: "ok" },
      { id: "fail", label: "Failed", value: "3%", tone: "down" },
    ],
  },
};

export const LightAndDark: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className={`${theme} rounded-xl border bg-surface p-6 text-foreground`}
        >
          <p className="mb-3 text-xs font-semibold capitalize text-muted-foreground">
            {theme}
          </p>
          <ChartTooltip
            title="Apr 3, 14:00 – 15:00"
            rows={[
              { id: "ok", label: "Healthy", value: "58", tone: "ok" },
              { id: "down", label: "Unhealthy", value: "1", tone: "down" },
            ]}
            footer="59 runs"
          />
        </div>
      ))}
    </div>
  ),
};
