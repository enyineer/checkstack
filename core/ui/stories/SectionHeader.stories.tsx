import type { Meta, StoryObj } from "@storybook/react";
import { Activity } from "lucide-react";
import { SectionHeader } from "../src/components/SectionHeader";

const meta: Meta<typeof SectionHeader> = {
  title: "Components/Layout/SectionHeader",
  component: SectionHeader,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SectionHeader>;

export const Default: Story = {
  args: {
    title: "Recent activity",
    description: "Last 24 hours of health-check transitions.",
    icon: <Activity className="h-5 w-5" />,
  },
};
