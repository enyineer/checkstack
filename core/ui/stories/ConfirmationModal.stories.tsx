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

const Demo = ({
  variant,
  isLoading = false,
}: {
  variant: "danger" | "warning" | "info";
  isLoading?: boolean;
}) => {
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
        isLoading={isLoading}
      />
    </>
  );
};

export const Danger: Story = { render: () => <Demo variant="danger" /> };
export const Warning: Story = { render: () => <Demo variant="warning" /> };
export const Info: Story = { render: () => <Demo variant="info" /> };

// Built on the accessible Dialog primitive: Escape, focus trap, and focus
// restoration are inherited; while loading the modal cannot be dismissed.
export const Loading: Story = {
  render: () => <Demo variant="danger" isLoading />,
};
