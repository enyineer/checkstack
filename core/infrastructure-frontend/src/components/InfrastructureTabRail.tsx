import type { ComponentType } from "react";
import { cn } from "@checkstack/ui";

/**
 * One contributed tab as the rail needs to render it: a stable id, a label,
 * and the leading icon component. Kept deliberately narrow so the rail stays
 * decoupled from the slot-extension shape it is fed from.
 */
export interface InfrastructureTabRailItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface InfrastructureTabRailProps {
  tabs: InfrastructureTabRailItem[];
  activeTabId: string | undefined;
  onSelect: (tabId: string) => void;
}

/**
 * Premium, depth-aware vertical navigator for the infrastructure settings
 * shell. Rather than a bare bordered column, the rail is a contained panel with
 * a soft layered shadow, and each active tab is multi-encoded: a left accent
 * stripe (position + hue), an inset surface, and a tinted leading icon — so the
 * selection reads like an IDE sidebar, not a flat shadcn nav.
 */
export const InfrastructureTabRail = ({
  tabs,
  activeTabId,
  onSelect,
}: InfrastructureTabRailProps) => {
  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-2 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
      {tabs.map(({ id, label, icon: Icon }) => {
        const isActive = id === activeTabId;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              "group relative flex items-center gap-3 overflow-hidden rounded-[calc(var(--d-card-r)-4px)] px-3 py-2.5 text-left text-sm font-medium transition-all",
              isActive
                ? "bg-surface-inset text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface-inset hover:text-foreground",
            )}
          >
            {isActive && (
              <span
                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                aria-hidden
              />
            )}
            <Icon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            {label}
          </button>
        );
      })}
    </nav>
  );
};
