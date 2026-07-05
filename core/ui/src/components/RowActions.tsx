import * as React from "react";
import { cn } from "../utils";
import { Button } from "./Button";

/**
 * RowActions - the container for a table row's action cluster. Renders its
 * actions right-aligned with consistent spacing. Pair with {@link RowAction}
 * so every data table's actions look identical.
 */
export function RowActions({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex items-center justify-end gap-1", className)}>
      {children}
    </div>
  );
}

export interface RowActionProps {
  /**
   * The action's icon component (e.g. a lucide `Trash2`). Rendered at a fixed
   * size so actions never differ in size between tables.
   */
  icon: React.ComponentType<{ className?: string }>;
  /** Accessible name for the button; also the default tooltip. */
  label: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  /** Tooltip override (e.g. a "Managed by GitOps" lock reason). Defaults to `label`. */
  title?: string;
  /**
   * Tints the icon while keeping the same quiet ghost-button shape - `RowAction`
   * is deliberately never a solid filled button, so a delete or a confirm reads
   * the same weight as an edit across every table. `destructive` is red (delete,
   * remove); `success` is green (resolve, complete, approve).
   */
  tone?: "default" | "destructive" | "success";
}

/**
 * RowAction - the single, canonical style for a table row action: a subtle,
 * compact ghost icon button. `tone="destructive"` only tints it; it is never a
 * loud filled button. Use inside {@link RowActions}.
 */
export const RowAction = React.forwardRef<HTMLButtonElement, RowActionProps>(
  ({ icon: Icon, label, onClick, disabled, title, tone = "default" }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 w-7 p-0",
        tone === "destructive" &&
          "text-destructive hover:bg-destructive/10 hover:text-destructive/90",
        tone === "success" &&
          "text-success hover:bg-success/10 hover:text-success/90",
      )}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  ),
);
RowAction.displayName = "RowAction";
