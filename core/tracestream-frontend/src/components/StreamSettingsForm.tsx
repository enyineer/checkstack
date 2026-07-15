import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Input,
  Label,
  Textarea,
  Button,
  Checkbox,
  useToast,
  toastError,
  useInitOnceForKey,
} from "@checkstack/ui";
import {
  TracestreamApi,
  type TraceStream,
  type TraceStreamConfig,
  type TraceSamplingConfig,
} from "@checkstack/tracestream-common";
import { describeSamplingPolicy } from "../lib/sampling-copy";

interface FormState {
  name: string;
  description: string;
  config: TraceStreamConfig;
}

/** The numeric top-level config knobs the number-field renderer edits. */
type NumericConfigKey = {
  [K in keyof TraceStreamConfig]-?: TraceStreamConfig[K] extends number
    ? K
    : never;
}[keyof TraceStreamConfig];

function fromStream(stream: TraceStream): FormState {
  return {
    name: stream.name,
    description: stream.description ?? "",
    config: stream.config,
  };
}

export interface StreamSettingsFormProps {
  stream: TraceStream;
  /** False for read-only viewers: inputs disabled, no save. */
  canManage: boolean;
}

/**
 * Stream settings form: name, description, the sampling policy (with a
 * plain-language summary), caps and retention. Seeds once per stream id so a
 * background refetch (signal-driven) never clobbers in-progress edits.
 */
export function StreamSettingsForm({ stream, canManage }: StreamSettingsFormProps) {
  const client = usePluginClient(TracestreamApi);
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => fromStream(stream));

  useInitOnceForKey(stream, stream.id, (s) => setForm(fromStream(s)));

  const updateMutation = client.updateStream.useGatedMutation({
    gateInput: { id: stream.id },
    onSuccess: () => toast.success("Settings saved"),
    onError: (error) => toastError(toast, "Failed to save settings", error),
  });

  const setConfig = (patch: Partial<TraceStreamConfig>) =>
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));

  const setSampling = (patch: Partial<TraceSamplingConfig>) =>
    setForm((f) => ({
      ...f,
      config: { ...f.config, sampling: { ...f.config.sampling, ...patch } },
    }));

  const disabled = !canManage || updateMutation.isPending;
  const sampling = form.config.sampling;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: stream.id,
      body: {
        name: form.name.trim(),
        description: form.description.trim() || null,
        config: form.config,
      },
    });
  };

  const numberField = (
    label: string,
    key: NumericConfigKey,
    hint: string,
    props?: { min?: number; max?: number },
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cfg-${key}`}>{label}</Label>
      <Input
        id={`cfg-${key}`}
        type="number"
        value={form.config[key]}
        min={props?.min}
        max={props?.max}
        disabled={disabled}
        onChange={(e) =>
          setConfig({ [key]: Number(e.target.value) } as Partial<TraceStreamConfig>)
        }
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="stream-name">Name</Label>
            <Input
              id="stream-name"
              value={form.name}
              disabled={disabled}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stream-description">Description</Label>
            <Textarea
              id="stream-description"
              value={form.description}
              disabled={disabled}
              rows={2}
              maxLength={2000}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sampling</CardTitle>
          <CardDescription>
            Tail-based sampling decides which completed traces keep their raw
            spans. Every trace always keeps a lightweight summary either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Plain-language summary of the current policy. */}
          <ul className="space-y-1 rounded-lg border bg-surface-inset p-3 text-sm text-muted-foreground">
            {describeSamplingPolicy(sampling).map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-primary">
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={sampling.keepErrorTraces}
              disabled={disabled}
              onCheckedChange={(checked) =>
                setSampling({ keepErrorTraces: checked })
              }
            />
            Always keep traces with an error span
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-slow">Slow-trace threshold (ms)</Label>
              <Input
                id="cfg-slow"
                type="number"
                min={0}
                max={3_600_000}
                placeholder="Off"
                value={sampling.slowTraceThresholdMs ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  setSampling({
                    slowTraceThresholdMs:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Keep any trace at least this slow. Blank disables the rule.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-baseline">Baseline sample (%)</Label>
              <Input
                id="cfg-baseline"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={round4(sampling.baselineSampleRate * 100)}
                disabled={disabled}
                onChange={(e) =>
                  setSampling({
                    baselineSampleRate: clamp01(Number(e.target.value) / 100),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Share of the remaining traces kept as a baseline.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-maxretained">Max retained / hour</Label>
              <Input
                id="cfg-maxretained"
                type="number"
                min={1}
                max={10_000_000}
                placeholder="No ceiling"
                value={sampling.maxRetainedTracesPerHour ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  setSampling({
                    maxRetainedTracesPerHour:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <p className="text-xs text-muted-foreground">
                Hard ceiling; overflow keeps a summary only. Blank = no ceiling.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Caps</CardTitle>
          <CardDescription>
            Values past a cap are dropped and surfaced as an important event;
            existing services and operations keep updating.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {numberField(
            "Services per stream",
            "serviceCap",
            "Max distinct service names tracked.",
            { min: 1, max: 100_000 },
          )}
          {numberField(
            "Operations per service",
            "operationCapPerService",
            "Max distinct span names per service.",
            { min: 1, max: 100_000 },
          )}
          {numberField(
            "Spans per trace",
            "maxSpansPerTrace",
            "Spans past this are dropped from the trace.",
            { min: 1, max: 1_000_000 },
          )}
          {numberField(
            "Soft rate limit / minute",
            "softRateLimitPerMinute",
            "Ingest above this returns 429 with Retry-After.",
            { min: 0, max: 10_000_000 },
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {numberField(
            "Retained spans (days)",
            "retainedTraceRetentionDays",
            "Raw spans of retained traces.",
            { min: 1, max: 90 },
          )}
          {numberField(
            "Summaries (days)",
            "summaryRetentionDays",
            "Lightweight per-trace summaries.",
            { min: 1, max: 365 },
          )}
          {numberField(
            "Minute buckets (hours)",
            "minuteRetentionHours",
            "Before rollup to hourly.",
            { min: 1, max: 24 * 30 },
          )}
          {numberField(
            "Hourly / events (days)",
            "hourlyRetentionDays",
            "Hourly buckets and important events.",
            { min: 1, max: 730 },
          )}
        </CardContent>
        {canManage && (
          <CardFooter className="justify-end">
            <Button type="submit" disabled={disabled}>
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Round to 4 decimals to keep a percent field from showing float noise. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
