import type { Meta, StoryObj } from "@storybook/react";
import { CommandPalette } from "../src/components/CommandPalette";

const meta: Meta<typeof CommandPalette> = {
  title: "Components/Navigation/CommandPalette",
  component: CommandPalette,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CommandPalette>;

export const Default: Story = {
  render: () => (
    <div className="max-w-2xl">
      <CommandPalette
        onClick={() => {
          /* open palette */
        }}
      />
    </div>
  ),
};

export const CustomPlaceholder: Story = {
  render: () => (
    <div className="max-w-2xl">
      <CommandPalette
        placeholder="Find a health check, satellite, or runbook…"
        onClick={() => {
          /* open palette */
        }}
      />
    </div>
  ),
};
