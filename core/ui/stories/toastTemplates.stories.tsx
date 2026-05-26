import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../src/components/Button";
import { useToast } from "../src/components/ToastProvider";
import { toastError, toastSuccess } from "../src/utils/toastTemplates";

const meta: Meta = {
  title: "Foundations/toastTemplates",
};

export default meta;
type Story = StoryObj;

const Demo = () => {
  const toast = useToast();

  return (
    <div className="space-y-3 max-w-md">
      <p className="text-sm text-muted-foreground">
        Fire the canonical success / error toasts. The error helper
        prefixes the action and truncates long messages to 100 characters.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => toastSuccess(toast, "Check created")}>
          Fire success
        </Button>

        <Button
          variant="destructive"
          onClick={() =>
            toastError(
              toast,
              "Failed to create check",
              new Error("Backend unreachable"),
            )
          }
        >
          Fire error
        </Button>

        <Button
          variant="outline"
          onClick={() =>
            toastError(
              toast,
              "Failed to import config",
              new Error(
                "Validation failed: " + "x".repeat(300),
              ),
            )
          }
        >
          Fire truncated error
        </Button>
      </div>
    </div>
  );
};

export const Helpers: Story = { render: () => <Demo /> };
