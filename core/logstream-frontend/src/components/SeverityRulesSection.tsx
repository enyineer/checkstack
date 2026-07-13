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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
  toastError,
  useInitOnceForKey,
} from "@checkstack/ui";
import {
  LogstreamApi,
  SEVERITY_BANDS,
  type LogStream,
  type SeverityBand,
} from "@checkstack/logstream-common";
import { Plus, Trash2 } from "lucide-react";
import { severityBandLabel } from "../lib/severity-tone";
import { truncatePatternLabel } from "../health-options-resolvers";
import {
  formToSeverityRules,
  severityRulesToForm,
  type PatternOverrideRow,
  type SeverityRulesFormState,
  type ValueMapRow,
} from "../lib/severity-rules-form";

export interface SeverityRulesSectionProps {
  stream: LogStream;
  /** False for read-only viewers: inputs disabled, no save. */
  canManage: boolean;
}

/** Narrow a Select's string value to a band without a type cast. */
function toBand(value: string): SeverityBand | null {
  return SEVERITY_BANDS.find((band) => band === value) ?? null;
}

/** Band picker shared by both editors. */
function BandSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: SeverityBand;
  onChange: (band: SeverityBand) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const band = toBand(next);
        if (band) onChange(band);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-32 shrink-0" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEVERITY_BANDS.map((band) => (
          <SelectItem key={band} value={band}>
            {severityBandLabel(band)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Per-stream severity remapping. Two editors folded into one card:
 * - value map: re-band a raw source severity value (for apps that log at the
 *   "wrong" level, e.g. errors emitted at INFO);
 * - pattern overrides: re-band every line of a chosen pattern.
 * Both persist into the stream's `config.severityRules` via the shared
 * `updateStream` merge; clearing every row stores an empty object so a previous
 * mapping is removed. Gated on the contract-derived `updateStream` verdict.
 */
export function SeverityRulesSection({
  stream,
  canManage,
}: SeverityRulesSectionProps) {
  const client = usePluginClient(LogstreamApi);
  const toast = useToast();
  const [form, setForm] = useState<SeverityRulesFormState>(() =>
    severityRulesToForm(stream.config.severityRules),
  );
  // Fresh ids for rows added after the initial seed (which uses index ids).
  const nextId = useRef(0);
  const mintId = (prefix: string) => `${prefix}-new-${nextId.current++}`;

  useInitOnceForKey(stream, stream.id, (s) =>
    setForm(severityRulesToForm(s.config.severityRules)),
  );

  const { data: patterns } = client.listPatterns.useQuery({
    streamId: stream.id,
    limit: 500,
  });

  const updateMutation = client.updateStream.useGatedMutation({
    gateInput: { id: stream.id },
    onSuccess: () => toast.success("Severity rules saved"),
    onError: (error) => toastError(toast, "Failed to save severity rules", error),
  });

  const disabled = !canManage || updateMutation.isPending;

  const setValueMap = (rows: ValueMapRow[]) =>
    setForm((f) => ({ ...f, valueMap: rows }));
  const setOverrides = (rows: PatternOverrideRow[]) =>
    setForm((f) => ({ ...f, patternOverrides: rows }));

  const handleSave = () => {
    // `{}` (not undefined) clears any previously-saved rules, since the config
    // merge replaces the key with whatever we send.
    updateMutation.mutate({
      id: stream.id,
      body: { config: { severityRules: formToSeverityRules(form) ?? {} } },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Severity rules</CardTitle>
        <CardDescription>
          Fix mislabeled severities for this stream. Use a value mapping when your
          app logs at the wrong level (for example, errors emitted at INFO, or a
          framework that uses WARNING instead of warn). Use a pattern override to
          re-band every line of one pattern. Matching is case-insensitive.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Value mapping</Label>
          <p className="text-xs text-muted-foreground">
            Map a raw source severity value (like <code>INFO</code> or{" "}
            <code>emerg</code>) to the band it should count as.
          </p>
          <div className="space-y-2">
            {form.valueMap.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  value={row.value}
                  disabled={disabled}
                  placeholder="Source value (e.g. INFO)"
                  aria-label="Source severity value"
                  className="min-w-0 flex-1"
                  onChange={(e) =>
                    setValueMap(
                      form.valueMap.map((r) =>
                        r.id === row.id ? { ...r, value: e.target.value } : r,
                      ),
                    )
                  }
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  counts as
                </span>
                <BandSelect
                  value={row.band}
                  disabled={disabled}
                  ariaLabel="Mapped band"
                  onChange={(band) =>
                    setValueMap(
                      form.valueMap.map((r) =>
                        r.id === row.id ? { ...r, band } : r,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label="Remove mapping"
                  onClick={() =>
                    setValueMap(form.valueMap.filter((r) => r.id !== row.id))
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
            disabled={disabled}
            onClick={() =>
              setValueMap([
                ...form.valueMap,
                { id: mintId("value"), value: "", band: "error" },
              ])
            }
          >
            <Plus className="size-4" />
            Add mapping
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Pattern overrides</Label>
          <p className="text-xs text-muted-foreground">
            Force every line of a specific pattern to a band, regardless of its
            source severity.
          </p>
          <div className="space-y-2">
            {form.patternOverrides.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Select
                  value={row.patternId || undefined}
                  disabled={disabled}
                  onValueChange={(patternId) =>
                    setOverrides(
                      form.patternOverrides.map((r) =>
                        r.id === row.id ? { ...r, patternId } : r,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    className="min-w-0 flex-1"
                    aria-label="Pattern"
                  >
                    <SelectValue placeholder="Choose a pattern" />
                  </SelectTrigger>
                  <SelectContent>
                    {(patterns ?? []).map((pattern) => (
                      <SelectItem key={pattern.id} value={pattern.id}>
                        <span className="font-mono text-xs">
                          {truncatePatternLabel(pattern.template)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="shrink-0 text-xs text-muted-foreground">
                  becomes
                </span>
                <BandSelect
                  value={row.band}
                  disabled={disabled}
                  ariaLabel="Override band"
                  onChange={(band) =>
                    setOverrides(
                      form.patternOverrides.map((r) =>
                        r.id === row.id ? { ...r, band } : r,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label="Remove override"
                  onClick={() =>
                    setOverrides(
                      form.patternOverrides.filter((r) => r.id !== row.id),
                    )
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
            disabled={disabled}
            onClick={() =>
              setOverrides([
                ...form.patternOverrides,
                { id: mintId("pattern"), patternId: "", band: "error" },
              ])
            }
          >
            <Plus className="size-4" />
            Add override
          </Button>
        </div>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button type="button" onClick={handleSave} disabled={disabled}>
            {updateMutation.isPending ? "Saving..." : "Save severity rules"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
