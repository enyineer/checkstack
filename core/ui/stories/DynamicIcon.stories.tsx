import type { Meta, StoryObj } from "@storybook/react";
import { DynamicIcon } from "../src/components/DynamicIcon";

const meta: Meta<typeof DynamicIcon> = {
  title: "Components/Display/DynamicIcon",
  component: DynamicIcon,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DynamicIcon>;

export const Named: Story = {
  args: { name: "HeartPulse", className: "h-8 w-8 text-primary" },
};

export const Fallback: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <DynamicIcon name={undefined} className="h-6 w-6" />
      <span className="text-sm text-muted-foreground">
        Falls back to <code>Settings</code> when no name is given.
      </span>
    </div>
  ),
};

export const Gallery: Story = {
  render: () => (
    <div className="grid grid-cols-6 gap-4">
      {[
        "AlertCircle",
        "Activity",
        "Bell",
        "Cloud",
        "Database",
        "Heart",
        "ShieldCheck",
        "Server",
        "Terminal",
        "Settings",
        "Wrench",
        "Zap",
      ].map((name) => (
        <div key={name} className="flex flex-col items-center gap-2 text-xs">
          <DynamicIcon name={name as never} className="h-6 w-6" />
          <span className="text-muted-foreground">{name}</span>
        </div>
      ))}
    </div>
  ),
};
