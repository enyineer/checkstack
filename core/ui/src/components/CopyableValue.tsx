import React, { useEffect, useRef } from "react";
import { Copy } from "lucide-react";
import { Button } from "./Button";
import { Alert, AlertDescription } from "./Alert";
import { useToast } from "./ToastProvider";
import { cn } from "../utils";

export interface CopyableValueProps {
  /** The value to display and copy to the clipboard. */
  value: string;
  /**
   * Human-readable name for the value, used for the copy button's aria-label
   * and the success toast (e.g. `"API key"` -> `"API key copied"`). Defaults to
   * `"Value"`.
   */
  label?: string;
  /**
   * When true, render a warning callout above the value and style it for a
   * "shown once" secret (the value is auto-selected on mount so it can be copied
   * straight away via the keyboard).
   */
  shownOnce?: boolean;
  /**
   * Message shown in the warning callout when `shownOnce` is true. Defaults to a
   * generic "copy it now" warning.
   */
  warningMessage?: string;
  /** Optional className for the outer wrapper. */
  className?: string;
}

/**
 * A monospace value paired with a copy-to-clipboard button and toast feedback.
 *
 * Generalises the duplicated secret/value-copy patterns (auth application
 * secrets, status-page DNS records). With `shownOnce` it renders a warning
 * callout and auto-selects the value on mount so keyboard users can copy it
 * immediately.
 */
export const CopyableValue: React.FC<CopyableValueProps> = ({
  value,
  label = "Value",
  shownOnce = false,
  warningMessage = "Copy this now - it will not be shown again.",
  className,
}) => {
  const toast = useToast();
  const valueRef = useRef<HTMLElement>(null);

  // Auto-select a "shown once" value on mount so it can be copied via the
  // keyboard without first reaching for the mouse.
  useEffect(() => {
    if (!shownOnce) return;
    const node = valueRef.current;
    if (!node) return;
    const selection = globalThis.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [shownOnce]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {shownOnce && (
        <Alert variant="warning">
          <AlertDescription>{warningMessage}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2">
        <code
          ref={valueRef}
          className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-sm text-foreground"
        >
          {value}
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copy()}
          aria-label={`Copy ${label}`}
          className="shrink-0"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
CopyableValue.displayName = "CopyableValue";
