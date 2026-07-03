import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { DistributionBar } from "../../src/components/charts";

const meta: Meta<typeof DistributionBar> = {
  title: "Charts/DistributionBar",
  component: DistributionBar,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof DistributionBar>;

const statusCodes = [
  { id: "200", label: "200", value: 1412 },
  { id: "301", label: "301", value: 122 },
  { id: "404", label: "404", value: 31 },
  { id: "500", label: "500", value: 4 },
];

export const StatusCodes: Story = {
  render: () => (
    <div className="max-w-xl">
      <DistributionBar
        slices={statusCodes}
        ariaLabel="HTTP status code distribution"
      />
    </div>
  ),
};

export const LongTailRollsUp: Story = {
  render: () => (
    <div className="max-w-xl">
      <DistributionBar
        slices={Array.from({ length: 12 }, (_, i) => ({
          id: `code-${i}`,
          label: `${200 + i * 25}`,
          value: Math.max(1, Math.round(500 / (i + 1))),
        }))}
        maxSlices={6}
        ariaLabel="Status distribution with a long tail"
      />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="max-w-xl">
      <DistributionBar slices={[]} ariaLabel="Status code distribution" />
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
          <DistributionBar
            slices={statusCodes}
            ariaLabel="HTTP status code distribution"
          />
        </div>
      ))}
    </div>
  ),
};
