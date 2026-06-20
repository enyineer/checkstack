import { cn, formatNumber } from "@checkstack/ui";
import { countToneStyles, type CountTone } from "./jobDisplay.logic";

export interface CountTileProps {
  label: string;
  value: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
  tone: CountTone;
}

/**
 * A number-led premium stat tile for the queue health KPIs. Leads with the
 * value as the hero figure, demotes the label to a status pill, and multi-
 * encodes status via the pill hue + dot, a left accent stripe, and the tone
 * icon. The "default" tone (Processing) stays neutral, color reserved for
 * actual signal.
 */
export const CountTile = ({ label, value, icon: Icon, tone }: CountTileProps) => {
  const styles = countToneStyles[tone];
  const isStatus = tone !== "default";

  return (
    <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-colors duration-200 hover:border-primary/40">
      {/* Status accent stripe: status by position + hue, not color alone. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
        aria-hidden
      />

      <div className="flex items-center justify-between gap-2 pl-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            styles.pill,
          )}
        >
          {isStatus && (
            <span
              className={cn("size-1.5 rounded-full", styles.dot)}
              aria-hidden
            />
          )}
          {label}
        </span>
        <Icon className={cn("h-5 w-5 shrink-0", styles.icon)} aria-hidden />
      </div>

      <div className="mt-3 pl-2">
        <div className="text-3xl font-bold leading-none tabular-nums text-foreground">
          {value === undefined ? "—" : formatNumber(value)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">jobs</div>
      </div>
    </div>
  );
};
