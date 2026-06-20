import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { RequestWaterfall } from "../../src/components/charts";
import { sampleWaterfall } from "./sample-data";

const meta: Meta<typeof RequestWaterfall> = {
  title: "Charts/RequestWaterfall",
  component: RequestWaterfall,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof RequestWaterfall>;

export const WaitBottleneck: Story = {
  args: { phases: sampleWaterfall },
};

export const BalancedFastRequest: Story = {
  args: {
    phases: [
      { id: "dns", label: "DNS", durationMs: 8 },
      { id: "tcp", label: "TCP", durationMs: 14 },
      { id: "tls", label: "TLS", durationMs: 22 },
      { id: "req", label: "Request", durationMs: 3 },
      { id: "wait", label: "Wait (TTFB)", durationMs: 26 },
      { id: "transfer", label: "Transfer", durationMs: 9 },
    ],
  },
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
          <RequestWaterfall phases={sampleWaterfall} />
        </div>
      ))}
    </div>
  ),
};
