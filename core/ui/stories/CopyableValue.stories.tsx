import type { Meta, StoryObj } from "@storybook/react";
import { CopyableValue } from "../src/components/CopyableValue";

const meta: Meta<typeof CopyableValue> = {
  title: "Components/Data/CopyableValue",
  component: CopyableValue,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof CopyableValue>;

export const Basic: Story = {
  render: () => (
    <div className="max-w-md">
      <CopyableValue
        label="Webhook URL"
        value="https://checkstack.example.com/api/webhooks/abc123"
      />
    </div>
  ),
};

export const ShownOnceSecret: Story = {
  render: () => (
    <div className="max-w-md">
      <CopyableValue
        label="API key"
        value="example_api_key_0000_not_a_real_secret"
        shownOnce
      />
    </div>
  ),
};

export const DnsRecord: Story = {
  render: () => (
    <div className="max-w-md">
      <CopyableValue
        label="TXT record"
        value="checkstack-verify=8f3a1c2b-verify-token"
      />
    </div>
  ),
};
