import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { ChartCard, Sparkline } from "../../src/components/charts";
import { Badge } from "../../src/components/Badge";
import { Input } from "../../src/components/Input";
import {
  DateRangeFilter,
  type DateRange,
} from "../../src/components/DateRangeFilter";
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

/**
 * A wide actions cluster (search + a date-range filter in "Custom" mode, which
 * reveals two datetime pickers) must WRAP onto its own line inside the
 * overflow-hidden card, not run off the clipped right edge. Rendered in a
 * constrained width so the wrap is visible; both custom pickers stay reachable.
 */
export const WideActionsWrap: Story = {
  render: () => {
    const WideActions = () => {
      // A non-preset (~10 day) window so the filter starts in Custom mode with
      // both datetime pickers visible - the exact crowded state to verify.
      const [range, setRange] = useState<DateRange>(() => {
        const endDate = new Date();
        return {
          startDate: new Date(endDate.getTime() - 10 * 24 * 60 * 60 * 1000),
          endDate,
        };
      });
      return (
        <div className="max-w-6xl">
          <ChartCard
            title="Metric explorer"
            actions={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Input
                  placeholder="Search metrics..."
                  className="h-9 w-44"
                  readOnly
                />
                <DateRangeFilter value={range} onChange={setRange} />
              </div>
            }
          >
            <Sparkline
              values={values}
              ariaLabel="Latency over the last 40 buckets"
            />
          </ChartCard>
        </div>
      );
    };
    return <WideActions />;
  },
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
