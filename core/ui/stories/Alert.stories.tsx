import type { Meta, StoryObj } from "@storybook/react";
import { CircleAlert, CircleCheck, Info, AlertTriangle } from "lucide-react";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "../src/components/Alert";

const meta: Meta<typeof Alert> = {
  title: "Components/Feedback/Alert",
  component: Alert,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "success", "warning", "error", "info"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Alert>;

export const Default: Story = {
  args: { variant: "default" },
  render: (args) => (
    <Alert {...args}>
      <AlertIcon>
        <Info className="w-4 h-4" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>
          This is an informational alert for plugin developers.
        </AlertDescription>
      </AlertContent>
    </Alert>
  ),
};

export const Success: Story = {
  args: { variant: "success" },
  render: (args) => (
    <Alert {...args}>
      <AlertIcon>
        <CircleCheck className="w-4 h-4" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>Plugin configuration was saved.</AlertDescription>
      </AlertContent>
    </Alert>
  ),
};

export const Warning: Story = {
  args: { variant: "warning" },
  render: (args) => (
    <Alert {...args}>
      <AlertIcon>
        <AlertTriangle className="w-4 h-4" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>
          The satellite token will expire in 24 hours.
        </AlertDescription>
      </AlertContent>
    </Alert>
  ),
};

export const Error: Story = {
  args: { variant: "error" },
  render: (args) => (
    <Alert {...args}>
      <AlertIcon>
        <CircleAlert className="w-4 h-4" />
      </AlertIcon>
      <AlertContent>
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>The health check failed to start.</AlertDescription>
      </AlertContent>
    </Alert>
  ),
};
