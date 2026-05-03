import React, { useState, useEffect } from "react";
import { Button, Input, Label } from "@checkstack/ui";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmPhrase: string;
  confirmLabel?: string;
  variant?: "danger" | "warning";
  isLoading?: boolean;
}

/**
 * Typed-confirmation modal: the user must type the exact phrase before the
 * confirm button enables. Used for both install (security warning) and
 * uninstall (destructive cleanup) flows. The strong typed confirmation is
 * the primary security control for plugin install — plugins run with full
 * platform access.
 */
export const TypedConfirmModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmPhrase,
  confirmLabel = "Confirm",
  variant = "danger",
  isLoading = false,
}) => {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (isOpen) setTyped("");
  }, [isOpen]);

  if (!isOpen) return;

  const matches = typed === confirmPhrase;
  const colors =
    variant === "danger"
      ? {
          icon: "text-destructive",
          iconBg: "bg-destructive/10",
          button:
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        }
      : {
          icon: "text-warning",
          iconBg: "bg-warning/10",
          button: "bg-warning text-warning-foreground hover:bg-warning/90",
        };

  return (
    <div
      className="fixed inset-0 z-[60] !m-0 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-background rounded-lg shadow-xl max-w-lg w-full mx-4 my-4 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-start gap-4">
            <div className={`rounded-full p-2 ${colors.iconBg}`}>
              <AlertTriangle className={`w-6 h-6 ${colors.icon}`} />
            </div>
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-muted-foreground hover:text-foreground"
            type="button"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 pb-4 space-y-4 text-sm">{description}</div>
        <div className="px-6 pb-4 space-y-2">
          <Label htmlFor="typed-confirm">
            Type{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-xs">
              {confirmPhrase}
            </code>{" "}
            to confirm:
          </Label>
          <Input
            id="typed-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={isLoading}
            autoFocus
            autoComplete="off"
          />
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 rounded-b-lg">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            type="button"
          >
            Cancel
          </Button>
          <button
            onClick={onConfirm}
            disabled={!matches || isLoading}
            className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors h-10 px-4 py-2 disabled:opacity-50 disabled:pointer-events-none ${colors.button}`}
            type="button"
          >
            {isLoading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
