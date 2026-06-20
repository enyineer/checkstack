import React, { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  cn,
} from "@checkstack/ui";
import type { PluginMetadata } from "@checkstack/common";
import { Lightbulb, X } from "lucide-react";
import { useTipState } from "../hooks/useTipState";

export interface TipProps {
  /**
   * The calling plugin's metadata. The plugin's `pluginId` is automatically
   * prepended to `id` to produce the fully-qualified tip identifier —
   * plugins never write the namespace themselves.
   */
  plugin: Pick<PluginMetadata, "pluginId">;

  /**
   * Local tip identifier — the part *after* the plugin's namespace.
   *
   * Must not start or end with `.` and must not include the plugin
   * separator. Two `<Tip>` instances with the same `(plugin, id)` share
   * dismissal state — useful when the same hint is pinned to multiple
   * equivalent affordances.
   */
  id: string;

  /** Headline shown bold at the top of the popover. */
  title: string;

  /** Optional explanatory body. Plain text or a node (e.g. for inline links). */
  description?: React.ReactNode;

  /** Optional CTA shown alongside "Got it". Triggering it also dismisses the tip. */
  action?: {
    label: string;
    onClick: () => void;
  };

  /** Where the popover opens relative to the lightbulb. Defaults to "bottom". */
  side?: "top" | "right" | "bottom" | "left";

  /** Alignment of the popover along the chosen side. Defaults to "end". */
  align?: "start" | "center" | "end";

  /**
   * The element a tip is configured for. Rendered as-is. The lightbulb
   * trigger is rendered immediately after, in a shared inline-flex
   * container so both stay visually grouped without disturbing the
   * surrounding layout.
   */
  children: React.ReactNode;

  /** Optional className applied to the popover content. */
  contentClassName?: string;

  /** Optional className applied to the lightbulb button. */
  triggerClassName?: string;
}

/**
 * Anchored, user-triggered hint.
 *
 * Renders `children` (typically a button, an icon, or any UI element you
 * want to explain) followed by a small lightbulb that, when clicked,
 * opens a popover with the tip text.
 *
 * The popover never auto-opens — first-time users see the lightbulb as a
 * subtle "more info available" affordance. Once they read the tip and
 * confirm with "Got it", the X icon, or the action button, the lightbulb
 * disappears for that user (per-user when signed in, per-browser when
 * anonymous) and the underlying element is rendered alone.
 *
 * Soft closes (clicking outside the popover, Escape) just close the
 * popover for now — the lightbulb remains so the user can re-open it.
 */
export const Tip: React.FC<TipProps> = ({
  plugin,
  id,
  title,
  description,
  action,
  side = "bottom",
  align = "end",
  children,
  contentClassName,
  triggerClassName,
}) => {
  const { isDismissed, isLoading, dismiss } = useTipState({ plugin, id });
  const [open, setOpen] = useState(false);

  const handleDismiss = () => {
    setOpen(false);
    dismiss();
  };

  // While we don't yet know whether the tip has been dismissed, render
  // only the underlying element to avoid a visible lightbulb flicker.
  if (isLoading || isDismissed) {
    return <>{children}</>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Show tip: ${title}`}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/5 text-warning hover:bg-warning/10 hover:text-warning/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40 transition-colors",
              triggerClassName,
            )}
          >
            <Lightbulb className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side={side}
          align={align}
          className={cn("w-80 p-[var(--d-pad)]", contentClassName)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning"
              >
                <Lightbulb className="size-3.5" />
              </span>
              <p className="text-sm font-semibold text-foreground">{title}</p>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Don't show this tip again"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
          {description && (
            <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
            {action && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  action.onClick();
                  handleDismiss();
                }}
              >
                {action.label}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              Got it
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
};
