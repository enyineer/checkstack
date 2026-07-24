import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "../src/components/StatusPill";
import type { StatusPillTone } from "../src/components/status-tone";

const meta: Meta = {
  title: "Components/Data/StatusPill",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

const TONES: StatusPillTone[] = ["ok", "warn", "down", "info", "unknown"];

/**
 * One pill for every status surface. Multi-encoded by design: hue AND a leading
 * dot AND the text label, so it never reads by colour alone.
 */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <StatusPill key={tone} tone={tone}>
          {tone}
        </StatusPill>
      ))}
    </div>
  ),
};

/**
 * `tone="neutral"` is for a state that deliberately carries NO hue, read from
 * its label alone. Use it when the row already spends its colour on a more
 * important dimension - an incident's lifecycle is neutral because its SEVERITY
 * owns the row's hue. It drops the dot: with no hue to encode, a grey dot adds
 * nothing.
 */
export const Neutral: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone="down">Major</StatusPill>
      <StatusPill tone="neutral">Investigating</StatusPill>
    </div>
  ),
};

/** `sm` for dense contexts - a public event card, a widget list. */
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone="ok">Default</StatusPill>
      <StatusPill tone="ok" size="sm">
        Small
      </StatusPill>
      <StatusPill tone="neutral" size="sm">
        Small neutral
      </StatusPill>
    </div>
  ),
};
