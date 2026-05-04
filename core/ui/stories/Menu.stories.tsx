import type { Meta, StoryObj } from "@storybook/react";
import { LogOut, Settings, User } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../src/components/Menu";

const meta: Meta = {
  title: "Components/Overlays/Menu (Dropdown items)",
};

export default meta;
type Story = StoryObj;

export const Items: Story = {
  render: () => (
    <div className="w-64 rounded-md border border-border bg-popover p-1 shadow-md">
      <DropdownMenuLabel>Account</DropdownMenuLabel>
      <DropdownMenuItem icon={<User className="h-4 w-4" />}>
        Profile
      </DropdownMenuItem>
      <DropdownMenuItem
        icon={<Settings className="h-4 w-4" />}
        description="Theme, notifications, integrations"
      >
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon={<LogOut className="h-4 w-4" />}>
        Sign out
      </DropdownMenuItem>
    </div>
  ),
};
