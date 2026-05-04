import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import { useToast } from "../src/components/ToastProvider";

const meta: Meta = {
  title: "Components/Feedback/Toast",
};

export default meta;
type Story = StoryObj;

const Demo = () => {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast.success("Saved successfully.")}>
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.info("Reload to see updates.")}>
        Info
      </Button>
      <Button variant="outline" onClick={() => toast.warning("Token expires in 24h.")}>
        Warning
      </Button>
      <Button variant="destructive" onClick={() => toast.error("Probe failed.")}>
        Error
      </Button>
    </div>
  );
};

export const Triggers: Story = { render: () => <Demo /> };
