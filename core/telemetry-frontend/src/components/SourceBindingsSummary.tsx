import { Badge } from "@checkstack/ui";
import type {
  SourceBinding,
  TelemetrySignal,
} from "@checkstack/telemetry-common";
import { bindingSummaryText } from "../lib/binding-editor.logic";

export interface SourceBindingsSummaryProps {
  bindings: SourceBinding[];
  /**
   * Resolved stream names per signal from the read DTO. A signal maps to null
   * when the bound stream no longer resolves (deleted, or its sink is not
   * installed); an absent key falls back to the stream id in the tooltip.
   */
  bindingStreamNames?: Partial<Record<TelemetrySignal, string | null>>;
}

/**
 * Compact per-source routing summary: one badge per bound signal, showing the
 * resolved target stream name when the read DTO provides it, and always the
 * signal plus stream name/id in the badge tooltip.
 */
export function SourceBindingsSummary({
  bindings,
  bindingStreamNames,
}: SourceBindingsSummaryProps) {
  if (bindings.length === 0) {
    return <span className="text-xs text-muted-foreground">Not routed</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {bindings.map((binding) => {
        const { primary, secondary, title } = bindingSummaryText({
          binding,
          streamName: bindingStreamNames?.[binding.signal],
        });
        return (
          <Badge key={binding.signal} variant="secondary" title={title}>
            {primary}
            {secondary && (
              <span className="ml-1 text-muted-foreground">{secondary}</span>
            )}
          </Badge>
        );
      })}
    </div>
  );
}
