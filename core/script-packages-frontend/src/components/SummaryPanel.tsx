import React from "react";
import { cn } from "@checkstack/ui";
import { toneStyles, type StatusTone } from "../pages/status-display";

/**
 * A premium number-led summary panel: the slo-card depth treatment (gradient
 * surface, layered shadow, soft border, density tokens) with a left accent
 * stripe driven by the status triad. Leads with a single hero figure, then a
 * caption, then a right-aligned cluster (status pill + action) and optional
 * metadata / footer rows.
 *
 * Visual only - it owns no domain logic; callers pass already-formatted text.
 */
export interface SummaryPanelProps {
  /** Status triad tone driving the left accent stripe. */
  tone: StatusTone;
  /** Optional leading glyph next to the title. */
  icon?: React.ReactNode;
  /** Section title, e.g. "Install state". */
  title: string;
  /** The single most important figure, rendered as the hero. */
  hero: React.ReactNode;
  /** Small caption beneath the hero, e.g. "installed size". */
  caption: string;
  /** Recolors the hero figure (e.g. status-warn when over a threshold). */
  heroToneClass?: string;
  /** Top-right cluster: status pill, action button, etc. */
  trailing?: React.ReactNode;
  /** Secondary metadata row (e.g. per-severity pills, last-run badge). */
  meta?: React.ReactNode;
  /** Footer content (explanatory copy, threshold notes, lists). */
  children?: React.ReactNode;
}

export const SummaryPanel: React.FC<SummaryPanelProps> = ({
  tone,
  icon,
  title,
  hero,
  caption,
  heroToneClass,
  trailing,
  meta,
  children,
}) => {
  const accent = toneStyles[tone].accent;
  return (
    <div className="group relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all duration-200 hover:border-border">
      {/* Status accent stripe: status by position + hue, not color alone. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", accent)}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3 pl-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </h3>
        {trailing && (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        )}
      </div>

      <div className="mt-4 pl-2">
        <p
          className={cn(
            "text-3xl font-bold leading-none tabular-nums",
            heroToneClass ?? "text-foreground",
          )}
        >
          {hero}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      </div>

      {meta && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-2">{meta}</div>
      )}

      {children && <div className="mt-3 pl-2">{children}</div>}
    </div>
  );
};
