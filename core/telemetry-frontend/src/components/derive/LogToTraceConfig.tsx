import { Input, Label } from "@checkstack/ui";
import type { SlotContext } from "@checkstack/frontend-api";
import type { SourceConfigSlot } from "@checkstack/telemetry-common";
import { readString, setStringField } from "../../lib/derive-config.logic";
import { InputStreamPicker } from "./InputStreamPicker";

type Props = SlotContext<typeof SourceConfigSlot>;

/**
 * Bespoke config editor for the built-in `telemetry.log-to-trace` derive source.
 * Only records carrying BOTH a W3C trace id and span id become spans (the backend
 * skips the rest), so the editor focuses on how to shape a span out of those
 * correlated records: its name, service, and optional duration.
 */
export function LogToTraceConfig({ config, onConfigChange, disabled }: Props) {
  const set = (key: string, value: string) =>
    onConfigChange(setStringField({ config, key, value }));

  return (
    <div className="space-y-4">
      <InputStreamPicker
        value={readString(config, "inputStreamId")}
        onChange={(streamId) => set("inputStreamId", streamId)}
        disabled={disabled}
      />

      <p className="text-xs text-muted-foreground">
        Only log records that already carry a W3C trace id and span id become
        spans; records without trace context are skipped.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="derive-trace-name-attr">Name attribute (optional)</Label>
        <Input
          id="derive-trace-name-attr"
          value={readString(config, "nameAttribute")}
          onChange={(e) => set("nameAttribute", e.target.value)}
          placeholder="http.route"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Dot-notation path whose value names the span; falls back to the fixed
          name below.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="derive-trace-fixed-name">Fixed name (optional)</Label>
        <Input
          id="derive-trace-fixed-name"
          value={readString(config, "fixedName")}
          onChange={(e) => set("fixedName", e.target.value)}
          placeholder="log span"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="derive-trace-duration">Duration attribute (optional)</Label>
        <Input
          id="derive-trace-duration"
          value={readString(config, "durationAttribute")}
          onChange={(e) => set("durationAttribute", e.target.value)}
          placeholder="duration_ms"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Dot-notation path to a numeric duration in milliseconds; the span starts
          this long before the log timestamp (else it is zero-width).
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="derive-trace-service">Service name source (optional)</Label>
        <Input
          id="derive-trace-service"
          value={readString(config, "serviceNameFrom")}
          onChange={(e) => set("serviceNameFrom", e.target.value)}
          placeholder="resource"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Use <code>resource</code> for the record's resource service name, or an
          attribute dot-path.
        </p>
      </div>
    </div>
  );
}
