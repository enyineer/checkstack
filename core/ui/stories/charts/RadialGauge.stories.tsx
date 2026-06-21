import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { RadialGauge } from "../../src/components/charts";

const meta: Meta<typeof RadialGauge> = {
  title: "Charts/RadialGauge",
  component: RadialGauge,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof RadialGauge>;

export const HeroAboveTarget: Story = {
  args: {
    value: 0.9994,
    displayValue: "99.94%",
    caption: "Above target 99.9%",
    captionTone: "ok",
    target: 0.999,
    variant: "hero",
    width: 260,
  },
};

export const HeroDegraded: Story = {
  args: {
    value: 0.962,
    displayValue: "96.2%",
    caption: "Below target 99.0%",
    captionTone: "down",
    target: 0.99,
    variant: "hero",
    width: 260,
  },
};

export const Quiet: Story = {
  args: {
    value: 0.87,
    displayValue: "87%",
    caption: "error budget",
    captionTone: "muted",
    variant: "quiet",
    width: 160,
  },
};

export const HeroVsQuiet: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-10">
      <RadialGauge
        value={0.9994}
        displayValue="99.94%"
        caption="Above target 99.9%"
        captionTone="ok"
        target={0.999}
        variant="hero"
        width={260}
      />
      <RadialGauge
        value={0.9994}
        displayValue="99.94%"
        caption="uptime"
        captionTone="muted"
        variant="quiet"
        width={160}
      />
    </div>
  ),
};

export const LightAndDark: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["light", "dark"] as const).map((theme) => (
        <div
          key={theme}
          className={`${theme} flex flex-col items-center rounded-xl border bg-surface p-6 text-foreground`}
        >
          <p className="mb-2 text-xs font-semibold capitalize text-muted-foreground">
            {theme}
          </p>
          <RadialGauge
            value={0.9994}
            displayValue="99.94%"
            caption="Above target 99.9%"
            captionTone="ok"
            target={0.999}
            variant="hero"
            width={240}
          />
        </div>
      ))}
    </div>
  ),
};
