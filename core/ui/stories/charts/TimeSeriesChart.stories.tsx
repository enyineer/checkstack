import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { TimeSeriesChart } from "../../src/components/charts";
import { latencySeries, p95Series } from "./sample-data";

const p50 = latencySeries();
const p95 = p95Series({ p50 });

const meta: Meta<typeof TimeSeriesChart> = {
  title: "Charts/TimeSeriesChart",
  component: TimeSeriesChart,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof TimeSeriesChart>;

const formatMs = (v: number) => `${Math.round(v)}ms`;

/** Theme panel: renders the same chart on light and dark surfaces. */
const DualTheme: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid gap-4 sm:grid-cols-2">
    <div className="light rounded-xl border bg-surface p-4 text-foreground">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Light</p>
      {children}
    </div>
    <div className="dark rounded-xl border bg-surface p-4 text-foreground">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Dark</p>
      {children}
    </div>
  </div>
);

export const P50WithP95: Story = {
  args: {
    primary: { id: "p50", label: "p50 latency", points: p50 },
    secondary: { id: "p95", label: "p95 latency", points: p95 },
    formatY: formatMs,
    height: 240,
  },
};

export const WithHealthyBandAndSlo: Story = {
  args: {
    primary: { id: "p50", label: "p50 latency", points: p50 },
    secondary: { id: "p95", label: "p95 latency", points: p95 },
    healthyBand: { from: 0, to: 180 },
    referenceLine: { value: 250, label: "SLO 250ms", tone: "warn" },
    formatY: formatMs,
    height: 240,
  },
};

export const PrimaryOnly: Story = {
  args: {
    primary: { id: "p50", label: "median latency", points: p50 },
    formatY: formatMs,
    height: 200,
  },
};

export const WithGap: Story = {
  args: {
    primary: {
      id: "p50",
      label: "median latency",
      points: p50.map((p, i) => (i > 18 && i < 24 ? { x: p.x, y: null } : p)),
    },
    formatY: formatMs,
    height: 200,
  },
};

export const Empty: Story = {
  args: {
    primary: { id: "p50", label: "median latency", points: [] },
    height: 200,
  },
};

export const LightAndDark: Story = {
  render: () => (
    <DualTheme>
      <TimeSeriesChart
        primary={{ id: "p50", label: "p50 latency", points: p50 }}
        secondary={{ id: "p95", label: "p95 latency", points: p95 }}
        healthyBand={{ from: 0, to: 180 }}
        referenceLine={{ value: 250, label: "SLO 250ms", tone: "warn" }}
        formatY={formatMs}
        height={220}
      />
    </DualTheme>
  ),
};
