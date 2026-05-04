import type { Meta, StoryObj } from "@storybook/react";
import { AccessDenied } from "../src/components/AccessDenied";

const meta: Meta<typeof AccessDenied> = {
  title: "Components/Feedback/AccessDenied",
  component: AccessDenied,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof AccessDenied>;

export const Default: Story = {};

export const CustomMessage: Story = {
  args: { message: "You need 'catalog.manage' to view this page." },
};
