import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SubscribeButton } from "../src/components/SubscribeButton";

const meta: Meta<typeof SubscribeButton> = {
  title: "Components/Inputs/SubscribeButton",
  component: SubscribeButton,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SubscribeButton>;

const Demo = ({ size }: { size: "default" | "sm" | "lg" | "icon" }) => {
  const [subscribed, setSubscribed] = useState(false);
  return (
    <SubscribeButton
      isSubscribed={subscribed}
      size={size}
      onSubscribe={() => setSubscribed(true)}
      onUnsubscribe={() => setSubscribed(false)}
    />
  );
};

export const IconButton: Story = { render: () => <Demo size="icon" /> };
export const Default: Story = { render: () => <Demo size="default" /> };
