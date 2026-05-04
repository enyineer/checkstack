import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../src/components/Dialog";

const meta: Meta = {
  title: "Components/Overlays/Dialog",
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit display name</DialogTitle>
          <DialogDescription>
            Renaming a system updates how it appears across all dashboards.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-sm text-muted-foreground">
          Form contents go here.
        </div>
        <DialogFooter>
          <Button variant="ghost">Cancel</Button>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const LargeSize: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open large dialog</Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Large dialog</DialogTitle>
          <DialogDescription>
            Use <code>size=&quot;lg&quot;</code> for forms with many fields.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 text-sm text-muted-foreground">…</div>
      </DialogContent>
    </Dialog>
  ),
};
