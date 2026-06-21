import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Sparkline } from "../../src/components/charts";
import { sparkValues } from "./sample-data";

const meta: Meta<typeof Sparkline> = {
  title: "Charts/Sparkline",
  component: Sparkline,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof Sparkline>;

const a = sparkValues({ seed: 1, base: 40, drift: 0.4 });
const b = sparkValues({ seed: 2, base: 70, drift: -0.3 });
const c = sparkValues({ seed: 3, base: 120, drift: 0.1, jitter: 18 });

export const Inline: Story = {
  render: () => (
    <p className="max-w-md text-sm text-foreground">
      p95 latency has trended{" "}
      <Sparkline values={a} tone="ok" ariaLabel="p95 latency, gently rising" width={72} /> up
      over the last day, while error rate{" "}
      <Sparkline values={b} tone="warn" ariaLabel="error rate, declining" width={72} /> has eased.
    </p>
  ),
};

/**
 * A column of small-multiples on a SHARED fixed domain (0..160), so heights are
 * directly comparable across rows - row C visibly sits higher.
 */
export const SharedScaleSmallMultiples: Story = {
  render: () => {
    const domain = { min: 0, max: 160 };
    const rows: Array<{ name: string; values: number[] }> = [
      { name: "api-gateway", values: a },
      { name: "auth-service", values: b },
      { name: "billing", values: c },
    ];
    return (
      <table className="text-sm text-foreground">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b">
              <td className="py-2 pr-6 font-mono">{r.name}</td>
              <td className="py-2">
                <Sparkline
                  values={r.values}
                  domain={domain}
                  tone="primary"
                  width={120}
                  ariaLabel={`${r.name} latency trend`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
};

export const Tones: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {(["primary", "ok", "warn", "down", "muted"] as const).map((tone) => (
        <Sparkline
          key={tone}
          values={c}
          tone={tone}
          width={160}
          ariaLabel={`${tone} sparkline`}
        />
      ))}
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
          <p className="mb-2 text-xs font-semibold capitalize text-muted-foreground">
            {theme}
          </p>
          <Sparkline values={c} tone="primary" width={200} ariaLabel="latency trend" />
        </div>
      ))}
    </div>
  ),
};
