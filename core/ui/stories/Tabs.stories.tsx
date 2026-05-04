import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TabPanel, Tabs, type TabItem } from "../src/components/Tabs";

const meta: Meta<typeof Tabs> = {
  title: "Components/Navigation/Tabs",
  component: Tabs,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

const items: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "config", label: "Configuration" },
];

const InteractiveTabs = () => {
  const [active, setActive] = useState("overview");
  return (
    <div className="space-y-4">
      <Tabs items={items} activeTab={active} onTabChange={setActive} />
      <TabPanel tabId="overview" activeTab={active}>
        <p className="text-sm text-muted-foreground">Overview content.</p>
      </TabPanel>
      <TabPanel tabId="history" activeTab={active}>
        <p className="text-sm text-muted-foreground">History content.</p>
      </TabPanel>
      <TabPanel tabId="config" activeTab={active}>
        <p className="text-sm text-muted-foreground">Configuration content.</p>
      </TabPanel>
    </div>
  );
};

export const Basic: Story = {
  render: () => <InteractiveTabs />,
};
