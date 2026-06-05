import type { Meta, StoryObj } from "@storybook/react";
import { Loader2 } from "lucide-react";
import { Spinner } from "../src/components/Spinner";
import { Button } from "../src/components/Button";
import { cn } from "../src/utils";

const meta: Meta<typeof Spinner> = {
  title: "Components/Feedback/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
  },
  args: {
    size: "sm",
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <Spinner size="sm" />
        <span className="text-xs text-muted-foreground">sm (h-4 w-4)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Spinner size="md" />
        <span className="text-xs text-muted-foreground">md (h-5 w-5)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Spinner size="lg" />
        <span className="text-xs text-muted-foreground">lg (h-6 w-6)</span>
      </div>
    </div>
  ),
};

export const InButton: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button disabled>
        <Spinner size="sm" className="mr-2" />
        Saving...
      </Button>
      <Button variant="outline" disabled>
        <Spinner size="sm" className="mr-2" />
        Loading
      </Button>
    </div>
  ),
};

export const WithAriaLabel: Story = {
  args: {
    "aria-label": "Loading",
  },
};

/**
 * On low-power devices (or when the OS requests reduced motion) the spinner
 * renders the static icon with no spin. The component handles this internally
 * via `usePerformance().isLowPower`; this story renders the static icon
 * directly to illustrate the result, since stories run with motion enabled.
 */
export const LowPowerStatic: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className={cn("h-4 w-4")} aria-hidden />
        <span className="text-xs text-muted-foreground">sm (no spin)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Loader2 className={cn("h-5 w-5")} aria-hidden />
        <span className="text-xs text-muted-foreground">md (no spin)</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Loader2 className={cn("h-6 w-6")} aria-hidden />
        <span className="text-xs text-muted-foreground">lg (no spin)</span>
      </div>
    </div>
  ),
};
