import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import {
  StackedTimeline,
  StatTile,
  TimeSeriesChart,
} from "../../src/components/charts";
import {
  latencySeries,
  sparkValues,
  stackedStatusBuckets,
} from "./sample-data";

const meta: Meta<typeof StatTile> = {
  title: "Charts/StatTile",
  component: StatTile,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof StatTile>;

const spark = sparkValues({ points: 30, base: 140, jitter: 15 });

export const Basic: Story = {
  args: {
    label: "Response Time",
    value: "142 ms",
    sparkline: {
      values: spark,
      ariaLabel: "Response time over the last 30 buckets",
    },
  },
};

export const WithDelta: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <StatTile
        label="Response Time"
        value="142 ms"
        delta={{ text: "+12 ms", direction: "up", sentiment: "bad" }}
        sparkline={{ values: spark, ariaLabel: "Response time trend" }}
      />
      <StatTile
        label="Success Rate"
        value="99.4%"
        tone="ok"
        delta={{ text: "+0.3%", direction: "up", sentiment: "good" }}
        sparkline={{
          values: sparkValues({ points: 30, base: 99, jitter: 1, drift: 0 }),
          tone: "ok",
          ariaLabel: "Success rate trend",
        }}
      />
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
      <StatTile label="Certificate Validity" value="42 days" tone="ok" />
      <StatTile label="Queue Depth" value="17" tone="warn" />
      <StatTile label="Failing Assertions" value="2" tone="down" />
    </div>
  ),
};

const ExpandableDemo: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="max-w-md">
      <StatTile
        label="Response Time"
        value="142 ms"
        hoverTitle="healthcheck.http:responseTime · instance #1"
        sparkline={{ values: spark, ariaLabel: "Response time trend" }}
        expanded={expanded}
        onToggleExpand={() => setExpanded((e) => !e)}
      >
        <TimeSeriesChart
          primary={{
            id: "rt",
            label: "Response time",
            points: latencySeries(),
          }}
          height={160}
          formatY={(v) => `${Math.round(v)}ms`}
        />
      </StatTile>
    </div>
  );
};

export const Expandable: Story = {
  render: () => <ExpandableDemo />,
};

const ExpandedTimelineDemo: React.FC = () => {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="max-w-md">
      <StatTile
        label="Assertion: statusCode equals 200"
        value="97% pass"
        tone="warn"
        expanded={expanded}
        onToggleExpand={() => setExpanded((e) => !e)}
      >
        <StackedTimeline
          buckets={stackedStatusBuckets({ buckets: 48, incidentAt: 30 }).map(
            (b) => ({
              ...b,
              counts: {
                ok: (b.counts.ok ?? 0) + (b.counts.warn ?? 0),
                down: b.counts.down,
              },
            }),
          )}
          toneLabels={{ ok: "Passed", down: "Failed" }}
          height={72}
          ariaLabel="Assertion pass/fail over the last 24 hours"
        />
      </StatTile>
    </div>
  );
};

export const ExpandedPassFail: Story = {
  render: () => <ExpandedTimelineDemo />,
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
          <StatTile
            label="Response Time"
            value="142 ms"
            delta={{ text: "+12 ms", direction: "up", sentiment: "bad" }}
            sparkline={{ values: spark, ariaLabel: "Response time trend" }}
          />
        </div>
      ))}
    </div>
  ),
};
