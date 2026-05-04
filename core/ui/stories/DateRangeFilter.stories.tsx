import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  DateRangeFilter,
  type DateRange,
  getDefaultDateRange,
} from "../src/components/DateRangeFilter";

const meta: Meta<typeof DateRangeFilter> = {
  title: "Components/Inputs/DateRangeFilter",
  component: DateRangeFilter,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DateRangeFilter>;

const Demo = () => {
  const [range, setRange] = useState<DateRange>(getDefaultDateRange());
  return (
    <div className="space-y-3">
      <DateRangeFilter value={range} onChange={setRange} />
      <p className="text-xs text-muted-foreground">
        {range.startDate.toISOString()} → {range.endDate.toISOString()}
      </p>
    </div>
  );
};

export const Default: Story = { render: () => <Demo /> };
