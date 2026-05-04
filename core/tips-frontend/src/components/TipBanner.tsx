import React from "react";
import { Card, CardContent, Button, cn } from "@checkstack/ui";
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

  if (isDismissed || isLoading) return null;

  return (
    <Card
      className={cn(
        "border border-primary/30 bg-primary/5",
        className,
      )}
    >
      <CardContent className="flex items-start gap-3 py-4">
        <div className="text-primary mt-0.5">
          {icon ?? <Lightbulb className="size-5" />}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && (
            <div className="mt-1 text-sm text-muted-foreground">
              {description}
            </div>
          )}
          {(action || actionHint) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
                <div className="text-xs text-muted-foreground sm:text-right ml-auto">
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
      </CardContent>
    </Card>
  );
};
