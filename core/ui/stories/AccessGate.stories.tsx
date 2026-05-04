import type { Meta, StoryObj } from "@storybook/react";
import { AccessGate } from "../src/components/AccessGate";

const allowed = () => ({ loading: false, allowed: true });
const denied = () => ({ loading: false, allowed: false });
const loading = () => ({ loading: true, allowed: false });

const meta: Meta<typeof AccessGate> = {
  title: "Components/Feedback/AccessGate",
  component: AccessGate,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof AccessGate>;

export const Allowed: Story = {
  args: {
    accessRuleId: "demo.read",
    useAccess: allowed,
    children: <p className="text-sm">Gated content visible.</p>,
  },
};

export const Hidden: Story = {
  args: {
    accessRuleId: "demo.read",
    useAccess: denied,
    children: <p className="text-sm">You should not see this.</p>,
  },
};

export const ShowDenied: Story = {
  args: {
    accessRuleId: "demo.read",
    useAccess: denied,
    showDenied: true,
    deniedMessage: "Demo access denied.",
    children: <p>Hidden</p>,
  },
};

export const Loading: Story = {
  args: {
    accessRuleId: "demo.read",
    useAccess: loading,
    children: <p>Resolves once access loads.</p>,
  },
};
