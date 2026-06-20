import type { Meta, StoryObj } from "@storybook/react";
import { DensityProvider, useDensity } from "../src/components/DensityProvider";
import { Button } from "../src/components/Button";

const meta: Meta = {
  title: "Foundations/DensityProvider",
};

export default meta;
type Story = StoryObj;

/**
 * A few surfaces sized entirely from the `--d-*` density tokens, so the single
 * class swap re-flows the whole sub-tree with no per-component conditionals.
 */
const DensityDemoSurfaces = () => (
  <div className="flex flex-col gap-[var(--d-gap)] max-w-md">
    <div
      className="rounded-[var(--d-card-r)] border bg-surface p-[var(--d-pad)]"
      style={{ color: "hsl(var(--surface-foreground))" }}
    >
      <p className="font-semibold" style={{ fontSize: "var(--d-title)" }}>
        Fleet uptime
      </p>
      <p
        className="tabular-nums font-bold"
        style={{ fontSize: "var(--d-num)" }}
      >
        99.98%
      </p>
    </div>
    {["api.checkstack.io", "db-primary", "edge-eu-west"].map((name) => (
      <div
        key={name}
        className="flex items-center rounded-md border bg-surface px-[var(--d-pad)]"
        style={{ height: "var(--d-row)" }}
      >
        <span className="text-sm">{name}</span>
      </div>
    ))}
  </div>
);

const Demo = () => {
  const { density, setDensity, toggleDensity } = useDensity();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant={density === "comfortable" ? "primary" : "outline"}
          onClick={() => setDensity("comfortable")}
        >
          Comfortable
        </Button>
        <Button
          variant={density === "compact" ? "primary" : "outline"}
          onClick={() => setDensity("compact")}
        >
          Compact
        </Button>
        <Button variant="ghost" onClick={toggleDensity}>
          Toggle
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Active density: <strong>{density}</strong> (persisted per-user to
        localStorage). The surfaces below render from identical markup; only the
        <code> --d-*</code> tokens change.
      </p>
      <DensityDemoSurfaces />
    </div>
  );
};

export const Adaptive: Story = {
  render: () => (
    <DensityProvider>
      <Demo />
    </DensityProvider>
  ),
};
