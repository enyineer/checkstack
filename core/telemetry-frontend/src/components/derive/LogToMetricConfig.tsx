import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@checkstack/ui";
import type { SlotContext } from "@checkstack/frontend-api";
import type { SourceConfigSlot } from "@checkstack/telemetry-common";
import {
  MAX_DERIVE_LABELS,
  readFilterField,
  readLabelsInput,
  readMode,
  readString,
  setFilterField,
  setLabels,
  setMode,
  setStringField,
} from "../../lib/derive-config.logic";
import { InputStreamPicker } from "./InputStreamPicker";

type Props = SlotContext<typeof SourceConfigSlot>;

/**
 * Bespoke config editor for the built-in `telemetry.log-to-metric` derive
 * source. Replaces the generic DynamicForm so the input stream is a real
 * log-stream picker and the mode-dependent fields (attribute path for
 * extractNumber) show only when relevant.
 */
export function LogToMetricConfig({ config, onConfigChange, disabled }: Props) {
  const mode = readMode(config);

  return (
    <div className="space-y-4">
      <InputStreamPicker
        value={readString(config, "inputStreamId")}
        onChange={(streamId) =>
          onConfigChange(setStringField({ config, key: "inputStreamId", value: streamId }))
        }
        disabled={disabled}
      />

      <div className="space-y-1.5">
        <Label htmlFor="derive-metric-name">Metric name</Label>
        <Input
          id="derive-metric-name"
          value={readString(config, "metricName")}
          onChange={(e) =>
            onConfigChange(setStringField({ config, key: "metricName", value: e.target.value }))
          }
          placeholder="log_events_total"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="derive-metric-mode">Mode</Label>
        <Select
          value={mode}
          onValueChange={(value) =>
            onConfigChange(
              setMode({ config, mode: value === "extractNumber" ? "extractNumber" : "count" }),
            )
          }
          disabled={disabled}
        >
          <SelectTrigger id="derive-metric-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="count">Count matching records</SelectItem>
            <SelectItem value="extractNumber">Extract a numeric attribute</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "extractNumber" && (
        <div className="space-y-1.5">
          <Label htmlFor="derive-metric-attr">Value attribute path</Label>
          <Input
            id="derive-metric-attr"
            value={readString(config, "attributePath")}
            onChange={(e) =>
              onConfigChange(setStringField({ config, key: "attributePath", value: e.target.value }))
            }
            placeholder="duration_ms"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Dot-notation path to a numeric attribute; each matching record emits a
            gauge sample.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="derive-metric-labels">Label attributes (optional)</Label>
        <Input
          id="derive-metric-labels"
          value={readLabelsInput(config)}
          onChange={(e) => onConfigChange(setLabels({ config, raw: e.target.value }))}
          placeholder="service.name, http.route"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Up to {MAX_DERIVE_LABELS} comma-separated attribute paths folded into
          series labels.
        </p>
      </div>

      <fieldset className="space-y-3 rounded-md border border-border bg-surface-inset p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          Filter (optional)
        </legend>
        <div className="space-y-1.5">
          <Label htmlFor="derive-metric-minsev">Minimum severity number</Label>
          <Input
            id="derive-metric-minsev"
            type="number"
            min={0}
            max={24}
            value={readFilterField(config, "minSeverityNumber")}
            onChange={(e) =>
              onConfigChange(
                setFilterField({ config, key: "minSeverityNumber", value: e.target.value }),
              )
            }
            placeholder="17"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            OTel severity number (17 = error). Records below this are ignored.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="derive-metric-body">Body contains</Label>
          <Input
            id="derive-metric-body"
            value={readFilterField(config, "bodyContains")}
            onChange={(e) =>
              onConfigChange(setFilterField({ config, key: "bodyContains", value: e.target.value }))
            }
            placeholder="timeout"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Plain substring the record body must contain (not a regex).
          </p>
        </div>
      </fieldset>
    </div>
  );
}
