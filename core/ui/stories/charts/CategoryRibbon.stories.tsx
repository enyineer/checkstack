import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { CategoryRibbon } from "../../src/components/charts";

const meta: Meta<typeof CategoryRibbon> = {
  title: "Charts/CategoryRibbon",
  component: CategoryRibbon,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof CategoryRibbon>;

const roleCells = Array.from({ length: 48 }, (_, i) => ({
  id: `cell-${i}`,
  category: i >= 20 && i < 24 ? "replica" : "primary",
  label: `Bucket ${i + 1}`,
}));

export const RoleFlip: Story = {
  render: () => (
    <div className="max-w-xl">
      <CategoryRibbon
        cells={roleCells}
        ariaLabel='Database role history: "primary" expected, 4 buckets reported "replica"'
      />
    </div>
  ),
};

export const ExplicitHighlight: Story = {
  render: () => (
    <div className="max-w-xl">
      <CategoryRibbon cells={roleCells} highlightCategory="replica" />
    </div>
  ),
};

export const AllStable: Story = {
  render: () => (
    <div className="max-w-xl">
      <CategoryRibbon
        cells={roleCells.map((c) => ({ ...c, category: "primary" }))}
      />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="max-w-xl">
      <CategoryRibbon cells={[]} />
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
          <CategoryRibbon cells={roleCells} />
        </div>
      ))}
    </div>
  ),
};
