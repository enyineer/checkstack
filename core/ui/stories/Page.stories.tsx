import type { Meta, StoryObj } from "@storybook/react";
import { Activity } from "lucide-react";
import { Button } from "../src/components/Button";
import { Page, PageContent, PageHeader } from "../src/components/Page";

const meta: Meta = {
  title: "Components/Layout/Page",
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Page className="h-[60vh]">
      <PageHeader
        title="Health"
        subtitle="Live system signals across all environments."
        icon={Activity}
        actions={<Button>New check</Button>}
      />
      <PageContent>
        <p className="text-sm text-muted-foreground">
          Page content scrolls independently of the header.
        </p>
      </PageContent>
    </Page>
  ),
};
