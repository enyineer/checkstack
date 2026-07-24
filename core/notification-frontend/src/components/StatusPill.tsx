import { StatusPill as SharedStatusPill } from "@checkstack/ui";
import type { StatusTone } from "./notificationDisplay.logic";

/**
 * Thin adapter over the shared pill in `@checkstack/ui`, keeping this package's
 * `label` prop so its call sites read unchanged. The chip itself is no longer
 * this plugin's business - only the notification status -> tone mapping is.
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
  return (
    <SharedStatusPill tone={tone} className={className}>
      {label}
    </SharedStatusPill>
  );
}
