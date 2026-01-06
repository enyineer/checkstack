import React from "react";
import { cn } from "../utils";
import { Button } from "./Button";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  isLoading = false,
}) => {
  if (!isOpen) return;

  const handleConfirm = () => {
    onConfirm();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const variantStyles = {
    danger: {
      icon: "text-destructive",
      iconBg: "bg-destructive/10",
      button:
        "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    },
    warning: {
      icon: "text-warning",
      iconBg: "bg-warning/10",
      button: "bg-warning text-warning-foreground hover:bg-warning/90",
    },
    info: {
      icon: "text-info",
      iconBg: "bg-info/10",
      button: "bg-info text-info-foreground hover:bg-info/90",
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className="fixed inset-0 z-[100] !m-0 flex items-center justify-center bg-black bg-opacity-50 transition-opacity"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-background rounded-lg shadow-xl max-w-md w-full mx-4 animate-in fade-in zoom-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-start gap-4">
            <div className={cn("rounded-full p-2", styles.iconBg)}>
              <AlertTriangle className={cn("w-6 h-6", styles.icon)} />
            </div>
            <div className="flex-1">
              <h3
                id="modal-title"
                className="text-lg font-semibold text-foreground"
              >
                {title}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6">
          <p
            id="modal-description"
            className="text-sm text-muted-foreground pl-14"
          >
            {message}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 rounded-b-lg">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            type="button"
          >
            {cancelText}
          </Button>
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            className={cn(
              "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none h-10 px-4 py-2",
              styles.button
            )}
            type="button"
          >
            {isLoading ? "Processing..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
