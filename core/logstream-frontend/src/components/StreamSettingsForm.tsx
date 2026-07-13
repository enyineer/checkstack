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
  Slider,
  useToast,
  toastError,
  useInitOnceForKey,
  formatNumber,
} from "@checkstack/ui";
import {
  LogstreamApi,
  DEFAULT_LOG_STREAM_CONFIG,
  type LogStream,
  type LogStreamConfig,
} from "@checkstack/logstream-common";

interface FormState {
  name: string;
  description: string;
  config: LogStreamConfig;
}

/**
 * The numeric config knobs the number-field renderer edits. Excludes the
 * non-scalar `severityRules` (edited by its own section, added in a later
 * phase), so `<Input type="number">` only ever binds a numeric value.
 */
type NumericConfigKey = {
  [K in keyof LogStreamConfig]-?: LogStreamConfig[K] extends number ? K : never;
}[keyof LogStreamConfig];

function fromStream(stream: LogStream): FormState {
  return {
    name: stream.name,
    description: stream.description ?? "",
    config: stream.config,
  };
}

export interface StreamSettingsFormProps {
  stream: LogStream;
  /** False for read-only viewers: inputs disabled, no save. */
  canManage: boolean;
}

/**
 * Stream settings form: name, description and the tiered-storage policy
 * (sampling, caps, retention). Seeds once per stream id so a background refetch
 * (signal-driven) never clobbers in-progress edits.
 */
export function StreamSettingsForm({
  stream,
  canManage,
}: StreamSettingsFormProps) {
  const client = usePluginClient(LogstreamApi);
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => fromStream(stream));

  useInitOnceForKey(stream, stream.id, (s) => setForm(fromStream(s)));

  const updateMutation = client.updateStream.useGatedMutation({
    gateInput: { id: stream.id },
    onSuccess: () => toast.success("Settings saved"),
    onError: (error) => toastError(toast, "Failed to save settings", error),
  });

  const setConfig = (patch: Partial<LogStreamConfig>) =>
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
          setConfig({ [key]: Number(e.target.value) } as Partial<LogStreamConfig>)
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
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
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
          <CardTitle>Sampling and caps</CardTitle>
          <CardDescription>
            Aggregates always carry full volume. These knobs govern how many raw
            lines are stored and for how long.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="cfg-sample">Info / debug sample rate</Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {Math.round(form.config.infoSampleRate * 100)}%
              </span>
            </div>
            <Slider
              id="cfg-sample"
              min={0}
              max={1}
              step={0.01}
              value={[form.config.infoSampleRate]}
              disabled={disabled}
              onValueChange={([v]) => setConfig({ infoSampleRate: v })}
            />
            <p className="text-xs text-muted-foreground">
              Fraction of info/debug lines kept as raw rows. Warn and above are
              always kept.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {numberField(
              "Max raw rows / minute",
              "maxRawPerMinute",
              "Hard cap on raw rows kept per minute; overflow is dropped.",
              { min: 0, max: 100_000 },
            )}
            {numberField(
              "Max line bytes",
              "maxLineBytes",
              "A single line's body is truncated to this many bytes.",
              { min: 256, max: 1_048_576 },
            )}
            {numberField(
              "Soft rate limit / minute",
              "softRateLimitPerMinute",
              `Ingest above this returns 429 (default ${formatNumber(
                DEFAULT_LOG_STREAM_CONFIG.softRateLimitPerMinute,
              )}).`,
              { min: 0, max: 10_000_000 },
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {numberField(
            "Raw retention (days)",
            "rawRetentionDays",
            "How long raw lines are kept.",
            { min: 1, max: 90 },
          )}
          {numberField(
            "Minute buckets (hours)",
            "minuteRetentionHours",
            "Before rollup to hourly.",
            { min: 1, max: 24 * 30 },
          )}
          {numberField(
            "Hourly / patterns (days)",
            "hourlyRetentionDays",
            "Hourly buckets, patterns and events.",
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
