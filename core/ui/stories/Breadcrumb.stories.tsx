import type { Meta, StoryObj } from "@storybook/react";
import { Breadcrumb } from "../src/components/Breadcrumb";

const meta: Meta<typeof Breadcrumb> = {
  title: "Components/Navigation/Breadcrumb",
  component: Breadcrumb,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Breadcrumb>;

export const Basic: Story = {
  render: () => (
    <Breadcrumb
      items={[
        { label: "Catalog", to: "/catalog" },
        { label: "Payments API", to: "/catalog/payments-api" },
        { label: "Health checks" },
      ]}
    />
  ),
};

export const SingleCurrentPage: Story = {
  render: () => <Breadcrumb items={[{ label: "Dashboard" }]} />,
};

export const WithSpaNavigation: Story = {
  render: () => (
    <Breadcrumb
      items={[
        { label: "Settings", to: "/settings" },
        { label: "Applications" },
      ]}
      onNavigate={(to) => {
        // In a real app this would call react-router's navigate(to).
        console.log("navigate to", to);
      }}
    />
  ),
};
