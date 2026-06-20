import { cn } from "@checkstack/ui";

const PREMIUM_CARD =
  "relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]";

interface HitRateHeroProps {
  /** Pre-formatted hit-rate text (e.g. `"94.2%"` or `"—"`); rendered as-is. */
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * The dominant runtime tile: a number-led hit-rate readout. Hit rate is a
 * descriptive workload metric, not a health signal - a low rate can be entirely
 * expected (a cold or write-heavy cache) - so no health tone/pill is applied.
 * Spans two columns on large screens, full width on mobile.
 */
export const HitRateHero = ({ value, icon: Icon }: HitRateHeroProps) => (
  <div
    className={cn(PREMIUM_CARD, "p-[var(--d-pad)] sm:col-span-2 lg:col-span-2")}
  >
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span className="text-xs font-medium">Hit rate</span>
    </div>
    <div className="mt-3">
      <p className="text-3xl font-bold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">hit rate</p>
    </div>
  </div>
);

interface SupportingTileProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * A demoted supporting KPI tile (Keys / Memory / Hits): value-led with a tinted
 * icon chip, sharing the hero's depth but at a smaller weight.
 */
export const SupportingTile = ({
  label,
  value,
  icon: Icon,
}: SupportingTileProps) => (
  <div
    className={cn(
      PREMIUM_CARD,
      "flex items-center gap-3 px-4 py-3",
    )}
  >
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-inset"
      aria-hidden
    >
      <Icon className="h-4 w-4 text-muted-foreground" />
    </span>
    <div className="min-w-0">
      <div className="text-2xl font-semibold tabular-nums leading-none">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  </div>
);
