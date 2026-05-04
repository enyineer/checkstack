import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "../src/components/Button";
import { ConfirmationModal } from "../src/components/ConfirmationModal";

const meta: Meta<typeof ConfirmationModal> = {
  title: "Components/Overlays/ConfirmationModal",
  component: ConfirmationModal,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ConfirmationModal>;

const Demo = ({ variant }: { variant: "danger" | "warning" | "info" }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant === "danger" ? "destructive" : "primary"}
        onClick={() => setOpen(true)}
      >
        Open {variant} modal
      </Button>
      <ConfirmationModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        title="Delete satellite?"
        message="This will revoke its token and delete recorded health-check history."
        confirmText="Delete"
        variant={variant}
      />
    </>
  );
};

export const Danger: Story = { render: () => <Demo variant="danger" /> };
export const Warning: Story = { render: () => <Demo variant="warning" /> };
export const Info: Story = { render: () => <Demo variant="info" /> };
