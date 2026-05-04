import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import { usePerformance } from "../src/components/PerformanceProvider";

const meta: Meta = {
  title: "Foundations/PerformanceProvider",
};

export default meta;
type Story = StoryObj;

const Demo = () => {
  const { isLowPower, manualLowPower, toggleManualLowPower } = usePerformance();
  return (
    <div className="space-y-3 max-w-md">
      <p className="text-sm">
        <code>isLowPower</code>: <strong>{String(isLowPower)}</strong>
      </p>
      <p className="text-sm">
        <code>manualLowPower</code>: <strong>{String(manualLowPower)}</strong>
      </p>
      <Button onClick={toggleManualLowPower}>
        Toggle low-power mode
      </Button>
      <p className="text-xs text-muted-foreground">
        Plugins should consume <code>usePerformance().isLowPower</code> to
        disable expensive animations / blurs.
      </p>
    </div>
  );
};

export const Toggle: Story = { render: () => <Demo /> };
