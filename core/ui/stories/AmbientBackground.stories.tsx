import type { Meta, StoryObj } from "@storybook/react";
import { AmbientBackground } from "../src/components/AmbientBackground";

const meta: Meta<typeof AmbientBackground> = {
  title: "Components/Layout/AmbientBackground",
  component: AmbientBackground,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof AmbientBackground>;

export const Default: Story = {
  render: () => (
    <AmbientBackground>
      <div className="max-w-3xl mx-auto py-24 px-6">
        <h1 className="text-4xl font-bold tracking-tight">Inverse glow grid</h1>
        <p className="mt-4 text-muted-foreground">
          Aurora blobs and a grid mask, with automatic graceful degradation when{" "}
          <code>usePerformance().isLowPower</code> is true.
        </p>
      </div>
    </AmbientBackground>
  ),
};
