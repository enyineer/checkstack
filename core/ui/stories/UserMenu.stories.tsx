import type { Meta, StoryObj } from "@storybook/react";
import { LogOut, Settings } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../src/components/Menu";
import { UserMenu } from "../src/components/UserMenu";

const meta: Meta<typeof UserMenu> = {
  title: "Components/Navigation/UserMenu",
  component: UserMenu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof UserMenu>;

export const Default: Story = {
  args: {
    user: { name: "Nico", email: "nico@example.com" },
  },
  render: (args) => (
    <UserMenu {...args}>
      <DropdownMenuLabel>{args.user.email}</DropdownMenuLabel>
      <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>
        Settings
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon={<LogOut className="h-4 w-4" />}>
        Sign out
      </DropdownMenuItem>
    </UserMenu>
  ),
};
