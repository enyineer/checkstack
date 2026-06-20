import React from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button, cn, usePerformance } from "@checkstack/ui";
import type { SecretMetadata } from "@checkstack/secrets-common";

/**
 * A single secret rendered as a contained premium row tile: layered depth, a
 * left accent stripe that multi-encodes the same status the pill carries
 * (hue + dot + label + position), and the unchanged Rotate / Delete actions.
 * The "set" / "no value" pill strings are preserved verbatim - they are
 * test-visible. The hover lift is gated behind `isLowPower`.
 */
export const SecretRow: React.FC<{
  secret: SecretMetadata;
  writable: boolean;
  onRotate: (name: string) => void;
  onDelete: (name: string) => void;
}> = ({ secret, writable, onRotate, onDelete }) => {
  const { isLowPower } = usePerformance();

  return (
    <li
      className={cn(
        "group relative flex items-center justify-between gap-3 overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface px-[var(--d-pad)] py-3 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        isLowPower
          ? "transition-colors hover:border-primary/40"
          : "transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl",
      )}
    >
      {/* Status accent stripe: status by position + hue, not color alone. */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          secret.hasValue ? "bg-status-ok" : "bg-status-down",
        )}
        aria-hidden
      />

      <div className="min-w-0 pl-2">
        <div className="flex items-center gap-2">
          <code className="text-sm font-semibold">{secret.name}</code>
          {secret.hasValue ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-ok/10 px-2.5 py-1 text-xs font-medium text-status-ok">
              <span
                className="size-1.5 rounded-full bg-status-ok"
                aria-hidden
              />
              set
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-down/10 px-2.5 py-1 text-xs font-medium text-status-down">
              <span
                className="size-1.5 rounded-full bg-status-down"
                aria-hidden
              />
              no value
            </span>
          )}
        </div>
        {secret.description && (
          <p className="truncate text-xs text-muted-foreground">
            {secret.description}
          </p>
        )}
      </div>
      {writable && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2",
            !isLowPower &&
              "opacity-100 transition-opacity sm:opacity-60 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
          )}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onRotate(secret.name)}
          >
            <RefreshCw className="h-4 w-4" />
            Rotate
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => onDelete(secret.name)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </li>
  );
};
