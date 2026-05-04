import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../src/components/Sheet";

const meta: Meta = {
  title: "Components/Overlays/Sheet",
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit system</SheetTitle>
          <SheetDescription>
            Slide-in side panel for secondary tasks.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <p className="text-sm text-muted-foreground">Form contents…</p>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};

export const LargeSize: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button>Open large sheet</Button>
      </SheetTrigger>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>Large sheet</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <p className="text-sm text-muted-foreground">
            Use <code>size=&quot;lg&quot;</code> for richer side panels.
          </p>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
};
