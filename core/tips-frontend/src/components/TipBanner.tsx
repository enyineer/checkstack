import React from "react";
import { Button, cn, usePerformance } from "@checkstack/ui";
import type { PluginMetadata } from "@checkstack/common";
import { Lightbulb, X } from "lucide-react";
import { useTipState } from "../hooks/useTipState";

export interface TipBannerProps {
  /**
   * The calling plugin's metadata. The plugin's `pluginId` is automatically
   * prepended to `id` to produce the fully-qualified tip identifier —
   * plugins never write the namespace themselves.
   */
  plugin: Pick<PluginMetadata, "pluginId">;
  /** Local tip identifier — the part *after* the plugin's namespace. */
  id: string;
  title: string;
  description?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * Optional hint content rendered immediately to the right of the action
   * button on the same row — useful for short notes that relate to the
   * primary CTA (e.g. "Look for the lightbulb icons elsewhere in the UI").
   * Wraps below the button on narrow viewports.
   */
  actionHint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Inline, dismissable callout for use at the top of a page or alongside
 * an empty state. Disappears entirely once dismissed (no anchor remains),
 * which makes it appropriate for "first-time on this page" coaching where
 * there's no ongoing UI element to attach to.
 */
export const TipBanner: React.FC<TipBannerProps> = ({
  plugin,
  id,
  title,
  description,
  action,
  actionHint,
  icon,
  className,
}) => {
  const { isDismissed, isLoading, dismiss } = useTipState({ plugin, id });
  const { isLowPower } = usePerformance();

  if (isDismissed || isLoading) return null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 p-[var(--d-pad)] transition-colors hover:border-warning/40",
        isLowPower
          ? "bg-surface-2"
          : "bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
        className,
      )}
    >
      {/* Left accent stripe: amber = the insight/lightbulb signal, kept off
          the ok/warn/down status triad since a tip is not a health state. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-warning"
      />
      <div className="flex items-start gap-3 pl-2">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
          {icon ?? <Lightbulb className="size-5" />}
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && (
            <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
          {(action || actionHint) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60 pt-3">
              {action ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    action.onClick();
                    dismiss();
                  }}
                >
                  {action.label}
                </Button>
              ) : (
                <span />
              )}
              {actionHint && (
                <div className="ml-auto text-xs text-muted-foreground sm:text-right">
                  {actionHint}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss tip"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
};
