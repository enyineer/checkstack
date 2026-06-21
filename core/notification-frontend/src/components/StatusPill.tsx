import { cn } from "@checkstack/ui";
import { toneStyles, type StatusTone } from "./notificationDisplay.logic";

/**
 * Status pill on the colorblind-safe status triad, multi-encoded with a dot
 * plus a text label (never color alone). Mirrors the pill shape used across
 * this package (StatusBadge, ChannelStatusPill) and `slo-frontend`.
 */
export function StatusPill({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  const styles = toneStyles[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        styles.pill,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
      {label}
    </span>
  );
}
