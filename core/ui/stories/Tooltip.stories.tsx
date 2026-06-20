import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "../src/components/Tooltip";

const meta: Meta<typeof Tooltip> = {
  title: "Components/Overlays/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

// The default trigger is a focusable button: Tab to the icon, then the tooltip
// opens on focus as well as hover (keyboard- and screen-reader-reachable).
export const Default: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="text-sm">Probe interval</span>
      <Tooltip content="How frequently this check runs against its target." />
    </div>
  ),
};

// `children` is an additive opt-in for a non-icon trigger.
export const CustomTrigger: Story = {
  render: () => (
    <Tooltip content="Runs against the target every 30 seconds.">
      <button
        type="button"
        className="text-sm underline decoration-dotted underline-offset-4"
      >
        Probe interval
      </button>
    </Tooltip>
  ),
};

// Long content flips/shifts near viewport edges via Radix collision handling.
export const LongContent: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="text-sm">Retention</span>
      <Tooltip content="Health-check samples are retained for 90 days, then downsampled to hourly rollups for a further 12 months before deletion." />
    </div>
  ),
};
