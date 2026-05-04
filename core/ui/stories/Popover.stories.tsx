import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../src/components/Popover";

const meta: Meta = {
  title: "Components/Overlays/Popover",
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4">
        <h4 className="font-medium leading-none mb-2">Filter</h4>
        <p className="text-sm text-muted-foreground">
          Use this for filter chips, info hovers, or quick edits.
        </p>
      </PopoverContent>
    </Popover>
  ),
};
