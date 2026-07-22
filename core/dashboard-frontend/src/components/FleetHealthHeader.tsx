import React, { useMemo } from "react";
import type { SystemSignalTone } from "@checkstack/catalog-common";
import {
  Card,
  CardContent,
  DynamicIcon,
  AnimatedCounter,
  cn,
} from "@checkstack/ui";
import type { SeverityCounts } from "../logic/systemSignals";

/** Status-triad text color for the headline figure + caption. */
type HealthTone = "ok" | "info" | "warn" | "down";
const toneText: Record<HealthTone, string> = {
  ok: "text-status-ok",
  info: "text-info",
  warn: "text-status-warn",
  down: "text-status-down",
};

/** One segment of the composition bar (worst-first). */
interface BarSegment {
  key: string;
  label: string;
  count: number;
  /** Bar fill + matching legend dot share this color. */
  fill: string;
}

/** A clickable severity in the legend (doubles as a problem-list filter). */
interface LegendFilter {
  tone: SystemSignalTone;
  label: string;
  count: number;
  dot: string;
  activeClass: string;
}

interface FleetHealthHeaderProps {
  systemsCount: number;
  problemsCount: number;
  counts: SeverityCounts;
  healthyCount: number;
  activeTone: SystemSignalTone | null;
  onToneSelect: (tone: SystemSignalTone | null) => void;
  isLowPower: boolean;
}

/**
 * The dashboard's fleet-health overview. It leads with the actionable figure -
 * how many systems need attention (or an all-clear) - in the dominant
 * severity's tone, backed by a proportional composition bar showing the
 * healthy-vs-problem mix at a glance. Beneath the bar, a color-dot legend
 * (dots matching the bar segments) breaks down the counts and doubles as a
 * filter for the problem list; "Healthy" is informational only, since healthy
 * systems intentionally stay out of the problem view.
 */
export const FleetHealthHeader: React.FC<FleetHealthHeaderProps> = ({
  systemsCount,
  problemsCount,
  counts,
  healthyCount,
  activeTone,
  onToneSelect,
  isLowPower,
}) => {
  const { caption, tone } = useMemo<{ caption: string; tone: HealthTone }>(() => {
    if (problemsCount === 0) {
      return { caption: "All systems healthy", tone: "ok" };
    }
    if (counts.error > 0) {
      return { caption: "Critical issues active", tone: "down" };
    }
    if (counts.warn > 0) {
      return { caption: "Degraded performance", tone: "warn" };
    }
    return { caption: "Worth a look", tone: "info" };
  }, [problemsCount, counts.error, counts.warn]);

  const segments: BarSegment[] = [
    { key: "error", label: "critical", count: counts.error, fill: "bg-status-down" },
    { key: "warn", label: "degraded", count: counts.warn, fill: "bg-status-warn" },
    { key: "info", label: "watch", count: counts.info, fill: "bg-status-info" },
    { key: "healthy", label: "healthy", count: healthyCount, fill: "bg-status-ok" },
  ];
  const barTotal = segments.reduce((sum, s) => sum + s.count, 0);
  const barLabel = segments
    .filter((s) => s.count > 0)
    .map((s) => `${s.count} ${s.label}`)
    .join(", ");

  const filters: LegendFilter[] = [
    {
      tone: "error",
      label: "Critical",
      count: counts.error,
      dot: "bg-status-down",
      activeClass: "bg-status-down/10 text-status-down",
    },
    {
      tone: "warn",
      label: "Degraded",
      count: counts.warn,
      dot: "bg-status-warn",
      activeClass: "bg-status-warn/10 text-status-warn",
    },
    {
      tone: "info",
      label: "Watch",
      count: counts.info,
      dot: "bg-status-info",
      activeClass: "bg-status-info/10 text-status-info",
    },
  ];

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface",
        !isLowPower &&
          "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
      )}
    >
      <CardContent className="flex flex-col gap-4 p-6">
        {/* Headline: the actionable figure (or all-clear), severity-toned. */}
        {problemsCount === 0 ? (
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-status-ok/10 text-status-ok">
              <DynamicIcon name="ShieldCheck" className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold text-foreground">
                All systems healthy
              </p>
              <p className="text-xs text-muted-foreground">
                <AnimatedCounter value={systemsCount} />{" "}
                {systemsCount === 1 ? "system" : "systems"} monitored
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-baseline gap-3">
            <span
              className={cn(
                "text-4xl font-bold leading-none tabular-nums",
                toneText[tone],
              )}
            >
              <AnimatedCounter value={problemsCount} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                of {systemsCount}{" "}
                {problemsCount === 1 ? "system needs" : "systems need"} attention
              </p>
              <p className={cn("text-sm font-medium", toneText[tone])}>
                {caption}
              </p>
            </div>
          </div>
        )}

        {/* Proportional composition bar: worst-first, color only on signal. */}
        {barTotal > 0 && (
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-inset"
            role="img"
            aria-label={`Fleet composition: ${barLabel}`}
          >
            {segments
              .filter((s) => s.count > 0)
              .map((s) => (
                <div
                  key={s.key}
                  className={s.fill}
                  style={{ width: `${(s.count / barTotal) * 100}%` }}
                />
              ))}
          </div>
        )}

        {/* Legend tied to the bar: color dots match the segments. The three
            severities double as problem-list filters; Healthy is informational
            (healthy systems stay out of the problem view). */}
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((f) => {
            const active = activeTone === f.tone;
            return (
              <button
                key={f.tone}
                type="button"
                aria-pressed={active}
                onClick={() => onToneSelect(active ? null : f.tone)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !isLowPower && "transition-colors",
                  active
                    ? f.activeClass
                    : "text-muted-foreground hover:bg-surface-inset",
                )}
              >
                <span className={cn("size-2 rounded-full", f.dot)} aria-hidden />
                <span className="font-semibold tabular-nums text-foreground">
                  {f.count}
                </span>
                <span>{f.label}</span>
              </button>
            );
          })}
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted-foreground">
            <span className="size-2 rounded-full bg-status-ok" aria-hidden />
            <span className="font-semibold tabular-nums text-foreground">
              {healthyCount}
            </span>
            <span>Healthy</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
