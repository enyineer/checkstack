import type { Meta, StoryObj } from "@storybook/react";
import { ShieldCheck } from "lucide-react";
import { Button } from "../src/components/Button";
import { PageLayout } from "../src/components/PageLayout";

const meta: Meta<typeof PageLayout> = {
  title: "Components/Layout/PageLayout",
  component: PageLayout,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof PageLayout>;

export const Allowed: Story = {
  render: () => (
    <div className="h-[60vh]">
      <PageLayout
        title="Access rules"
        subtitle="Define who can do what."
        icon={ShieldCheck}
        allowed
        actions={<Button>New rule</Button>}
      >
        <p className="text-sm text-muted-foreground">Rules table…</p>
      </PageLayout>
    </div>
  ),
};

export const Denied: Story = {
  render: () => (
    <div className="h-[60vh]">
      <PageLayout
        title="Access rules"
        subtitle="Define who can do what."
        icon={ShieldCheck}
        allowed={false}
      >
        <p>(Hidden)</p>
      </PageLayout>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="h-[60vh]">
      <PageLayout
        title="Access rules"
        subtitle="Define who can do what."
        icon={ShieldCheck}
        loading
      >
        <p>(Hidden while loading)</p>
      </PageLayout>
    </div>
  ),
};
