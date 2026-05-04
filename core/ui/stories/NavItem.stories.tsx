import type { Meta, StoryObj } from "@storybook/react";
import { Activity, Bell, Cog } from "lucide-react";
import { NavItem } from "../src/components/NavItem";

const meta: Meta<typeof NavItem> = {
  title: "Components/Navigation/NavItem",
  component: NavItem,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof NavItem>;

export const TopLevel: Story = {
  args: {
    to: "/health",
    label: "Health",
    icon: <Activity className="h-4 w-4" />,
  },
};

export const Nested: Story = {
  render: () => (
    <NavItem label="Settings" icon={<Cog className="h-4 w-4" />}>
      <NavItem to="/settings/notifications" label="Notifications" icon={<Bell className="h-4 w-4" />} />
      <NavItem to="/settings/general" label="General" icon={<Cog className="h-4 w-4" />} />
    </NavItem>
  ),
};
