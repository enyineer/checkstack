import type { Meta, StoryObj } from "@storybook/react";
import { Plus, ServerCog } from "lucide-react";
import { Button } from "../src/components/Button";
import { ListEmptyState } from "../src/components/ListEmptyState";

const meta: Meta<typeof ListEmptyState> = {
  title: "Components/Feedback/ListEmptyState",
  component: ListEmptyState,
  tags: ["autodocs"],
  args: {
    resource: "checks",
  },
};

export default meta;
type Story = StoryObj<typeof ListEmptyState>;

export const Default: Story = {};

export const WithDescription: Story = {
  args: {
    resource: "incidents",
    description:
      "Incidents are reported by operators and tracked through resolution updates.",
  },
};

export const WithAction: Story = {
  args: {
    resource: "checks",
    description:
      "Create a health check to start monitoring an endpoint.",
    actions: (
      <Button>
        <Plus className="h-4 w-4 mr-2" />
        Create your first check
      </Button>
    ),
  },
};

export const CustomIcon: Story = {
  args: {
    resource: "satellites",
    description: "Satellites probe remote networks Checkstack can't reach directly.",
    icon: <ServerCog className="h-10 w-10" />,
  },
};
