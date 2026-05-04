import type { Meta, StoryObj } from "@storybook/react";
import { NotFound } from "../src/components/NotFound";

const meta: Meta<typeof NotFound> = {
  title: "Components/Feedback/NotFound",
  component: NotFound,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof NotFound>;

export const Default: Story = {};

export const CustomMessage: Story = {
  args: { message: "We couldn't find the catalog system you requested." },
};
