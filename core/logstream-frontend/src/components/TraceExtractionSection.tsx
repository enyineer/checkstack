import { useRef, useState } from "react";
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
  Button,
  useToast,
  toastError,
  useInitOnceForKey,
} from "@checkstack/ui";
import {
  LogstreamApi,
  MAX_TRACE_EXTRACTION_PATHS,
  type LogStream,
} from "@checkstack/logstream-common";
import { Plus, Trash2 } from "lucide-react";
import {
  formToTraceExtraction,
  traceExtractionToForm,
  TRACE_EXTRACTION_FIELDS,
  type AttributePathRow,
  type FieldRuleFormState,
  type TraceExtractionField,
  type TraceExtractionFormState,
} from "../lib/trace-extraction-form";

export interface TraceExtractionSectionProps {
  stream: LogStream;
  /** False for read-only viewers: inputs disabled, no save. */
  canManage: boolean;
}

/** Display label + example copy per field. */
const FIELD_META: Record<
  TraceExtractionField,
  { label: string; pathExample: string; regexExample: string }
> = {
  traceId: {
    label: "Trace id",
    pathExample: "ctx.trace_id",
    regexExample: "trace_id=([0-9a-f]+)",
  },
  spanId: {
    label: "Span id",
    pathExample: "ctx.span_id",
    regexExample: "span_id=([0-9a-f]+)",
  },
};

/**
 * One field's editor (attribute paths + a body regex). Kept local so the two
 * fields share exactly one layout.
 */
function FieldRuleEditor({
  field,
  form,
  disabled,
  onChange,
  mintId,
}: {
  field: TraceExtractionField;
  form: FieldRuleFormState;
  disabled: boolean;
  onChange: (next: FieldRuleFormState) => void;
  mintId: () => string;
}) {
  const meta = FIELD_META[field];
  const setPaths = (attributePaths: AttributePathRow[]) =>
    onChange({ ...form, attributePaths });

  return (
    <div className="space-y-3 rounded-md border bg-surface-inset p-3">
      <Label>{meta.label}</Label>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Attribute paths, tried in order. The first string value found wins
          (dot notation into the line attributes, e.g. <code>{meta.pathExample}</code>).
        </p>
        <div className="space-y-2">
          {form.attributePaths.map((row) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                value={row.path}
                disabled={disabled}
                placeholder={meta.pathExample}
                aria-label={`${meta.label} attribute path`}
                className="min-w-0 flex-1 font-mono text-xs"
                onChange={(e) =>
                  setPaths(
                    form.attributePaths.map((r) =>
                      r.id === row.id ? { ...r, path: e.target.value } : r,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`Remove ${meta.label} attribute path`}
                onClick={() =>
                  setPaths(form.attributePaths.filter((r) => r.id !== row.id))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || form.attributePaths.length >= MAX_TRACE_EXTRACTION_PATHS}
          onClick={() =>
            setPaths([...form.attributePaths, { id: mintId(), path: "" }])
          }
        >
          <Plus className="size-4" />
          Add path
        </Button>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          Body regex
        </Label>
        <p className="text-xs text-muted-foreground">
          Optional. Applied to the line body when no attribute path matched;
          capture group 1 is the id (e.g. <code>{meta.regexExample}</code>).
        </p>
        <Input
          value={form.bodyRegex}
          disabled={disabled}
          placeholder={meta.regexExample}
          aria-label={`${meta.label} body regex`}
          className="font-mono text-xs"
          onChange={(e) => onChange({ ...form, bodyRegex: e.target.value })}
        />
      </div>
    </div>
  );
}

/**
 * Per-stream trace-correlation extraction rules for sources that don't emit W3C
 * ids natively (plain-text lines, syslog, arbitrary JSON). For each of trace id
 * and span id, an ordered list of attribute paths plus an optional body regex.
 * Persists into the stream's `config.traceExtraction` via the shared
 * `updateStream` merge; clearing every field stores an empty object so a
 * previous rule set is removed. Gated on the contract-derived `updateStream`
 * verdict; backend zod validation errors (a body regex that does not compile or
 * lacks a capture group) surface as a save toast.
 */
export function TraceExtractionSection({
  stream,
  canManage,
}: TraceExtractionSectionProps) {
  const client = usePluginClient(LogstreamApi);
  const toast = useToast();
  const [form, setForm] = useState<TraceExtractionFormState>(() =>
    traceExtractionToForm(stream.config.traceExtraction),
  );
  // Fresh ids for rows added after the initial seed (which uses index ids).
  const nextId = useRef(0);
  const mintId = () => `path-new-${nextId.current++}`;

  useInitOnceForKey(stream, stream.id, (s) =>
    setForm(traceExtractionToForm(s.config.traceExtraction)),
  );

  const updateMutation = client.updateStream.useGatedMutation({
    gateInput: { id: stream.id },
    onSuccess: () => toast.success("Trace extraction rules saved"),
    onError: (error) =>
      toastError(toast, "Failed to save trace extraction rules", error),
  });

  const disabled = !canManage || updateMutation.isPending;

  const handleSave = () => {
    // `{}` (not undefined) clears any previously-saved rules, since the config
    // merge replaces the key with whatever we send.
    updateMutation.mutate({
      id: stream.id,
      body: { config: { traceExtraction: formToTraceExtraction(form) ?? {} } },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trace correlation</CardTitle>
        <CardDescription>
          Pull trace and span ids out of sources that don&apos;t send them
          natively (plain-text logs, syslog, custom JSON). Rules apply only when a
          line has no id yet - OTLP ids always win. Extracted ids are normalized
          (dashes stripped, lowercased) before they are stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {TRACE_EXTRACTION_FIELDS.map((field) => (
          <FieldRuleEditor
            key={field}
            field={field}
            form={form[field]}
            disabled={disabled}
            mintId={mintId}
            onChange={(next) => setForm((f) => ({ ...f, [field]: next }))}
          />
        ))}
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button type="button" onClick={handleSave} disabled={disabled}>
            {updateMutation.isPending ? "Saving..." : "Save trace extraction"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
