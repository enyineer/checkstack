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
  useToast,
  toastError,
  useInitOnceForKey,
  formatNumber,
} from "@checkstack/ui";
import {
  MetricstreamApi,
  DEFAULT_METRIC_STREAM_CONFIG,
  type MetricStream,
  type MetricStreamConfig,
} from "@checkstack/metricstream-common";

interface FormState {
  name: string;
  description: string;
  config: MetricStreamConfig;
}

/** The numeric config knobs the number-field renderer edits (all scalar). */
type NumericConfigKey = {
  [K in keyof MetricStreamConfig]-?: MetricStreamConfig[K] extends number
    ? K
    : never;
}[keyof MetricStreamConfig];

function fromStream(stream: MetricStream): FormState {
  return {
    name: stream.name,
    description: stream.description ?? "",
    config: stream.config,
  };
}

export interface StreamSettingsFormProps {
  stream: MetricStream;
  /** False for read-only viewers: inputs disabled, no save. */
  canManage: boolean;
}

/**
 * Stream settings form: name, description and the cardinality/rate/retention
 * policy. Seeds once per stream id so a background refetch (signal-driven)
 * never clobbers in-progress edits.
 */
export function StreamSettingsForm({
  stream,
  canManage,
}: StreamSettingsFormProps) {
  const client = usePluginClient(MetricstreamApi);
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => fromStream(stream));

  useInitOnceForKey(stream, stream.id, (s) => setForm(fromStream(s)));

  const updateMutation = client.updateStream.useGatedMutation({
    gateInput: { id: stream.id },
    onSuccess: () => toast.success("Settings saved"),
    onError: (error) => toastError(toast, "Failed to save settings", error),
  });

  const setConfig = (patch: Partial<MetricStreamConfig>) =>
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));

  const disabled = !canManage || updateMutation.isPending;

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
          setConfig({
            [key]: Number(e.target.value),
          } as Partial<MetricStreamConfig>)
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
          <CardTitle>Cardinality and rate</CardTitle>
          <CardDescription>
            New series past the cap are dropped (and surfaced as an important
            event); existing series keep updating. Ingest above the soft rate
            limit returns 429.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {numberField(
            "Series cap",
            "seriesCap",
            "Max distinct series kept per stream.",
            { min: 100, max: 1_000_000 },
          )}
          {numberField(
            "Soft datapoints / minute",
            "softDatapointsPerMinute",
            `Ingest above this returns 429 (default ${formatNumber(
              DEFAULT_METRIC_STREAM_CONFIG.softDatapointsPerMinute,
            )}).`,
            { min: 0, max: 100_000_000 },
          )}
          {numberField(
            "Max datapoints / request",
            "maxDatapointsPerRequest",
            "Hard cap on datapoints accepted in one ingest request.",
            { min: 1, max: 1_000_000 },
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
