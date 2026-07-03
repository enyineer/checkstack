import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { StackedTimeline } from "../../src/components/charts";
import { stackedStatusBuckets } from "./sample-data";

const meta: Meta<typeof StackedTimeline> = {
  title: "Charts/StackedTimeline",
  component: StackedTimeline,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof StackedTimeline>;

const healthyDay = stackedStatusBuckets({ buckets: 48 });
const roughDay = stackedStatusBuckets({ buckets: 48, seed: 11, incidentAt: 30 });

export const MostlyHealthy: Story = {
  render: () => (
    <div className="max-w-2xl">
      <StackedTimeline
        buckets={healthyDay}
        ariaLabel="Run status distribution over the last 24 hours"
      />
    </div>
  ),
};

export const WithIncident: Story = {
  render: () => (
    <div className="max-w-2xl">
      <StackedTimeline
        buckets={roughDay}
        ariaLabel="Run status distribution over the last 24 hours"
      />
    </div>
  ),
};

export const PassFail: Story = {
  render: () => (
    <div className="max-w-2xl">
      <StackedTimeline
        buckets={roughDay.map((b) => ({
          ...b,
          counts: {
            ok: (b.counts.ok ?? 0) + (b.counts.warn ?? 0),
            down: b.counts.down,
          },
        }))}
        toneLabels={{ ok: "Passed", down: "Failed" }}
        ariaLabel="Assertion pass/fail counts over the last 24 hours"
      />
    </div>
  ),
};

export const Downsampled: Story = {
  render: () => (
    <div className="max-w-2xl">
      <StackedTimeline
        buckets={stackedStatusBuckets({ buckets: 300, seed: 4, incidentAt: 220 })}
        maxBars={60}
        ariaLabel="Run status distribution, downsampled from 300 buckets"
      />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="max-w-2xl">
      <StackedTimeline buckets={[]} ariaLabel="Run status distribution" />
    </div>
  ),
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
          <StackedTimeline
            buckets={roughDay}
            ariaLabel="Run status distribution over the last 24 hours"
          />
        </div>
      ))}
    </div>
  ),
};
