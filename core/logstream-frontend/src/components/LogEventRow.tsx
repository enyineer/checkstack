import { StatusBadge, CopyableValue, Button, cn, formatDateTime } from "@checkstack/ui";
import { ChevronRight, Tag, Wand2 } from "lucide-react";
import type { LogEvent } from "@checkstack/logstream-common";
import {
  severityBandIcon,
  severityBandLabel,
  severityBandToTone,
} from "../lib/severity-tone";
import { PatternTemplate } from "./PatternTemplate";

export interface LogEventRowProps {
  event: LogEvent;
  expanded: boolean;
  onToggle: () => void;
  /** Template for the event's pattern, if resolved (shown as a filter chip). */
  patternTemplate?: string;
  /** Filter the explorer to this event's pattern. */
  onFilterPattern?: (patternId: string) => void;
  /**
   * Whether the viewer may author a pattern (the create verdict, resolved ONCE
   * by the parent and passed down - never a per-row access hook, so the
   * virtualized list stays cheap; see `.claude/rules/performance.md`).
   */
  canCreatePattern?: boolean;
  /** Open the pattern builder seeded from this line. */
  onCreatePattern?: () => void;
}

/**
 * One monospace log line in the explorer. Collapsed: severity, timestamp and a
 * one-line truncated body. Expanded: full body, attributes JSON, trace/span ids
 * and a pattern chip that filters the explorer. Rows are dynamically measured
 * by the surrounding `VirtualList`, so expansion re-flows cleanly.
 */
export function LogEventRow({
  event,
  expanded,
  onToggle,
  patternTemplate,
  onFilterPattern,
  canCreatePattern,
  onCreatePattern,
}: LogEventRowProps) {
  return (
    <div className="border-b border-border/60 bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left transition-colors hover:bg-surface-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <StatusBadge
          tone={severityBandToTone(event.band)}
          icon={severityBandIcon(event.band)}
          label={severityBandLabel(event.band)}
          className="mt-px"
        />
        <time className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatDateTime(event.ts)}
        </time>
        <span
          className={cn(
            "min-w-0 flex-1 font-mono text-xs text-foreground",
            expanded ? "whitespace-pre-wrap break-words" : "truncate",
          )}
        >
          {event.body}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/40 px-3 py-3 pl-8">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Body
            </span>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-inset p-2 font-mono text-xs text-foreground">
              {event.body}
            </pre>
          </div>

          {canCreatePattern && onCreatePattern && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onCreatePattern();
              }}
            >
              <Wand2 className="size-4" />
              Create pattern from this line
            </Button>
          )}

          {event.patternId && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Pattern
              </span>
              {patternTemplate ? (
                <PatternTemplate template={patternTemplate} />
              ) : (
                <code className="font-mono text-xs text-muted-foreground">
                  {event.patternId}
                </code>
              )}
              {onFilterPattern && (
                <button
                  type="button"
                  onClick={() => onFilterPattern(event.patternId!)}
                  className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs text-primary transition-colors hover:bg-surface-inset"
                >
                  <Tag className="size-3" aria-hidden />
                  Filter to pattern
                </button>
              )}
            </div>
          )}

          {(event.traceId || event.spanId) && (
            <div className="flex flex-wrap gap-4">
              {event.traceId && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Trace id
                  </span>
                  <CopyableValue value={event.traceId} label="Trace id" />
                </div>
              )}
              {event.spanId && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Span id
                  </span>
                  <CopyableValue value={event.spanId} label="Span id" />
                </div>
              )}
            </div>
          )}

          {event.attributes && Object.keys(event.attributes).length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Attributes
              </span>
              <pre className="max-h-64 overflow-auto rounded-md bg-surface-inset p-2 font-mono text-xs text-foreground">
                {JSON.stringify(event.attributes, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
