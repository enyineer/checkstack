import type { Meta, StoryObj } from "@storybook/react";
import { BackLink } from "../src/components/BackLink";

const meta: Meta<typeof BackLink> = {
  title: "Components/Navigation/BackLink",
  component: BackLink,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof BackLink>;

export const Default: Story = {
  args: {
    onClick: () => {
      /* navigate back */
    },
  },
};

export const CustomLabel: Story = {
  args: {
    children: "Back to systems",
    onClick: () => {
      /* navigate back */
    },
  },
};

export const AsLink: Story = {
  args: { to: "/catalog" },
};
