import { cn } from "@checkstack/ui";
import { SEVERITY_BANDS, type SeverityBand } from "@checkstack/logstream-common";
import {
  severityBandIcon,
  severityBandLabel,
  severityBandToTone,
} from "../lib/severity-tone";

export interface SeverityBandPillsProps {
  /** Currently selected bands; empty = no severity filter (all bands). */
  value: SeverityBand[];
  /** Called with the clicked band; the parent applies its toggle semantics. */
  onToggle: (band: SeverityBand) => void;
  className?: string;
}

/**
 * The severity-band filter pill row (one toggleable chip per band), shared by
 * the explorer's toolbar and the overview's "Top patterns" card so the two
 * filters look and behave identically.
 */
export function SeverityBandPills({
  value,
  onToggle,
  className,
}: SeverityBandPillsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {SEVERITY_BANDS.map((band) => {
        const active = value.includes(band);
        const Icon = severityBandIcon(band);
        const tone = severityBandToTone(band);
        return (
          <button
            key={band}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(band)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors",
              active
                ? tone === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : tone === "warn"
                    ? "border-warning/40 bg-warning/10 text-warning"
                    : tone === "info"
                      ? "border-info/40 bg-info/10 text-info"
                      : "border-border bg-secondary text-secondary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-surface-inset",
            )}
          >
            <Icon className="size-3" aria-hidden />
            {severityBandLabel(band)}
          </button>
        );
      })}
    </div>
  );
}
