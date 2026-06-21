import React, { useEffect, useId, useState } from "react";
import { cn } from "../utils";
import { Button } from "./Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./Dialog";
import { Input } from "./Input";
import { Label } from "./Label";
import { AlertTriangle } from "lucide-react";

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  isLoading?: boolean;
  /**
   * When set, gates the confirm button behind a typed-phrase challenge: an
   * input is rendered and confirm stays disabled until the user types this
   * exact phrase. Used for high-blast-radius actions (e.g. plugin
   * install/uninstall). Omit for the standard confirm-on-click behavior.
   */
  confirmPhrase?: string;
  /**
   * Optional label rendered above the typed-phrase input. Defaults to a
   * "Type `<phrase>` to confirm:" prompt. Only used when `confirmPhrase` is set.
   */
  confirmPhraseLabel?: React.ReactNode;
  /** Placeholder for the typed-phrase input. Only used with `confirmPhrase`. */
  confirmPhrasePlaceholder?: string;
}

/**
 * Pure predicate for the typed-phrase gate: confirm is allowed only when no
 * phrase is required, or the typed value matches the required phrase exactly.
 * Extracted so the enable/disable logic is unit-testable without a DOM.
 */
export const isConfirmPhraseSatisfied = ({
  confirmPhrase,
  typedValue,
}: {
  confirmPhrase?: string;
  typedValue: string;
}): boolean => confirmPhrase === undefined || typedValue === confirmPhrase;

type ConfirmationVariant = NonNullable<ConfirmationModalProps["variant"]>;

export const confirmationVariantStyles: Record<
  ConfirmationVariant,
  { icon: string; iconBg: string; confirmClassName?: string }
> = {
  danger: {
    icon: "text-destructive",
    iconBg: "bg-destructive/10",
  },
  warning: {
    icon: "text-warning",
    iconBg: "bg-warning/10",
    confirmClassName:
      "bg-warning text-warning-foreground hover:bg-warning/90",
  },
  info: {
    icon: "text-info",
    iconBg: "bg-info/10",
    confirmClassName: "bg-info text-info-foreground hover:bg-info/90",
  },
};

/**
 * The shared {@link Button} variant a confirmation's confirm button should use
 * for a given semantic variant. Only `danger` maps to the dedicated
 * `destructive` button variant; `warning`/`info` reuse `primary` plus a
 * token-based `confirmClassName` override (no dedicated Button variants exist
 * for them, and they do not recur often enough to warrant adding them).
 */
export const confirmButtonVariant = (
  variant: ConfirmationVariant,
): "destructive" | "primary" => (variant === "danger" ? "destructive" : "primary");

/**
 * Destructive/confirmation gate built on the accessible Radix {@link Dialog}
 * primitive: focus trap, Escape-to-close, focus restoration to the trigger,
 * and body scroll-lock come for free (and the `isLowPower` animation branch is
 * inherited from `DialogContent`). The public prop API is unchanged from the
 * legacy hand-rolled modal so existing call sites need no edits.
 */
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
  confirmPhrase,
  confirmPhraseLabel,
  confirmPhrasePlaceholder,
}) => {
  const styles = confirmationVariantStyles[variant];
  const inputId = useId();
  const [typedValue, setTypedValue] = useState("");

  // Reset the typed challenge whenever the modal (re)opens so a previous
  // attempt never carries over into a fresh confirmation.
  useEffect(() => {
    if (isOpen) setTypedValue("");
  }, [isOpen]);

  const phraseSatisfied = isConfirmPhraseSatisfied({
    confirmPhrase,
    typedValue,
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        // Radix fires `onOpenChange(false)` for Escape, overlay click, and the
        // close button. Map that single signal to the legacy `onClose`. Ignore
        // close attempts while the confirm action is in flight.
        if (!next && !isLoading) onClose();
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <div className="flex items-start gap-4">
            <div className={cn("rounded-full p-2 shrink-0", styles.iconBg)}>
              <AlertTriangle className={cn("h-6 w-6", styles.icon)} />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-2">{message}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {confirmPhrase === undefined ? undefined : (
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {confirmPhraseLabel ?? (
                <>
                  Type{" "}
                  <code className="px-1 py-0.5 rounded bg-muted text-xs">
                    {confirmPhrase}
                  </code>{" "}
                  to confirm:
                </>
              )}
            </Label>
            <Input
              id={inputId}
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              disabled={isLoading}
              autoFocus
              autoComplete="off"
              placeholder={confirmPhrasePlaceholder}
            />
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            type="button"
          >
            {cancelText}
          </Button>
          <Button
            variant={confirmButtonVariant(variant)}
            onClick={onConfirm}
            disabled={isLoading || !phraseSatisfied}
            type="button"
            className={styles.confirmClassName}
          >
            {isLoading ? "Processing..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
