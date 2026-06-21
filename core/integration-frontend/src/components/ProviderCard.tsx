import { ArrowRight } from "lucide-react";
import { cn, DynamicIcon, Badge, type LucideIconName } from "@checkstack/ui";

export interface ProviderCardProps {
  /** Icon name from the provider definition; falls back to a webhook glyph. */
  icon: string | undefined;
  displayName: string;
  description?: string;
  /** Whether the provider exposes a connection schema (is configurable). */
  actionable: boolean;
}

/**
 * A single integration provider tile on the landing grid. Configurable
 * providers read as premium, liftable tiles (gradient depth, an ok-toned left
 * accent stripe, a "Configurable" pill, and a hover-revealed arrow affordance);
 * non-configurable providers read as inert through a flatter, gradient-less
 * surface rather than a blanket opacity fade. The icon chip is the visual
 * anchor for the provider's identity.
 */
export const ProviderCard = ({
  icon,
  displayName,
  description,
  actionable,
}: ProviderCardProps) => {
  // `icon` is a free-form string from the provider schema; bridge it to the
  // DynamicIcon name union the same way the rest of the integration UI does.
  const iconName = (icon as LucideIconName) ?? "Webhook";

  return (
    <div
      className={cn(
        "relative flex h-full flex-col overflow-hidden rounded-[var(--d-card-r)] p-[var(--d-pad)] transition-all duration-200",
        actionable
          ? "border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl group-hover:shadow-primary/10"
          : "border border-border/50 bg-surface",
      )}
    >
      {/* Actionability accent stripe: signal by position + hue, not color alone. */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          actionable ? "bg-status-ok" : "bg-border",
        )}
        aria-hidden
      />

      <div className="flex items-start gap-3 pl-2">
        <span className="grid size-10 shrink-0 place-items-center rounded-[calc(var(--d-card-r)-4px)] border border-border/60 bg-surface-inset text-primary">
          <DynamicIcon name={iconName} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </span>
            {actionable ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-status-ok/10 px-2.5 py-1 text-xs font-medium text-status-ok">
                <span className="size-1.5 rounded-full bg-status-ok" aria-hidden />
                Configurable
              </span>
            ) : (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                No connections
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>

      {actionable && (
        <div className="mt-auto flex justify-end pl-2 pt-4">
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      )}
    </div>
  );
};
