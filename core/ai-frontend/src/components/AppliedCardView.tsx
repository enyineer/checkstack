import { cn } from "@checkstack/ui";
import { CheckCircle2 } from "lucide-react";
import type { AppliedCard } from "../lib/stream-parser";
import { DiffView } from "./DiffView";
import {
  toolCardToneStyles,
  toolCardShell,
  toolCardInset,
  toolCardPill,
} from "./tool-card-styles";

/**
 * Read-only card for a change the assistant AUTO-APPLIED (auto mode). The change
 * already took effect, so there are no Apply/Decline buttons - this exists so the
 * operator ALWAYS sees what was changed or created, even when no confirmation was
 * required. For an update it shows the before -> after diff; for a create it shows
 * the created object.
 *
 * Mirrors ConfirmCardView's shell so the two read as a matched pair, but carries
 * the "ok" tone (a completed, successful change) instead of a pending one.
 */
export function AppliedCardView({ card }: { card: AppliedCard }) {
  const hasDiff = card.diff && card.diff.length > 0;
  const styles = toolCardToneStyles.ok;
  return (
    <div className={toolCardShell}>
      {/* Status accent stripe: a completed change, encoded by position + hue. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-1", styles.accent)}
        aria-hidden
      />
      <div className="space-y-3 pl-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", styles.icon)} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {card.summary}
              </p>
              <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {card.toolName}
              </p>
            </div>
          </div>
          <span className={cn(toolCardPill, styles.pill)}>
            <span className={cn("size-1.5 rounded-full", styles.dot)} aria-hidden />
            Applied
          </span>
        </div>

        {hasDiff ? (
          <div className={cn(toolCardInset, "overflow-hidden")}>
            <p className="px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Changes
            </p>
            <div className="p-2 pt-1">
              <DiffView diff={card.diff ?? []} />
            </div>
          </div>
        ) : card.result !== undefined && card.result !== null ? (
          <div className={cn(toolCardInset, "overflow-hidden")}>
            <p className="px-2 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Result
            </p>
            <pre className="max-h-48 overflow-auto p-2 pt-1 text-xs">
              {JSON.stringify(card.result, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
