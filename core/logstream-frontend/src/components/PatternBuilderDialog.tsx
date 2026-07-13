import React, { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Textarea,
  Label,
  FormError,
  cn,
  useToast,
} from "@checkstack/ui";
import { extractErrorMessage } from "@checkstack/common";
import { LogstreamApi } from "@checkstack/logstream-common";
import { Sparkles, Wand2 } from "lucide-react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  WILDCARD,
  canSavePattern,
  chipsToTemplate,
  templateToChips,
  toggleChip,
  type PatternChip,
} from "../lib/pattern-builder";

/** How many recent lines the live preview tests against (server default). */
const PREVIEW_SAMPLE_LIMIT = 100;
/** Debounce before re-running the live preview as the operator edits. */
const PREVIEW_DEBOUNCE_MS = 400;
/** Max chars a pasted line may carry (matches the `maskLine` proc's cap). */
const MAX_PASTE_CHARS = 32_768;

export interface PatternBuilderDialogProps {
  streamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A MASKED template to seed the chips from (e.g. an existing pattern's
   * template when entering from a log row). When present the builder opens
   * straight into the chip editor; when empty it opens on the paste box (if
   * `maskLine` is available) or advanced mode.
   */
  initialTemplate?: string;
  /**
   * Convert a raw pasted log line into a masked template, server-side (the
   * `maskLine` proc). Masking MUST run on the backend so the builder can never
   * drift from the ingest matcher, so when this is omitted the paste box is
   * hidden and the operator authors a raw template in advanced mode instead.
   */
  maskLine?: (body: string) => Promise<string>;
  /** Called with the new pattern id so the Patterns tab can highlight it. */
  onCreated?: (patternId: string) => void;
}

/**
 * The custom-pattern builder. An operator shapes a pattern by clicking the parts
 * of a log line that vary (each becomes a `<*>` wildcard); a debounced live
 * preview shows how many recent lines the candidate matches. The template is
 * authored entirely in the masked-token space (chips ARE the masked tokens), so
 * what the builder sends to `createPattern` is exactly what the ingest matcher
 * compares against.
 */
export function PatternBuilderDialog({
  streamId,
  open,
  onOpenChange,
  initialTemplate,
  maskLine,
  onCreated,
}: PatternBuilderDialogProps) {
  const client = usePluginClient(LogstreamApi);
  const toast = useToast();

  // Chips are the canonical state: they carry each token's original literal even
  // while it is toggled to a wildcard, so toggling back restores it (a template
  // string alone would lose it). Advanced mode edits a raw template directly.
  const [chips, setChips] = useState<PatternChip[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [rawTemplate, setRawTemplate] = useState("");
  const [pasteInput, setPasteInput] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Seed (and re-seed) the builder whenever it opens or its seed template
  // changes. Chips carry the masked tokens; advanced mode is the fallback when
  // there is no seed and no way to mask a pasted line. The effect depends on the
  // PRESENCE of `maskLine` (a stable boolean), never its identity - an inline
  // callback from the parent would otherwise re-run this every render and wipe
  // in-progress edits.
  const canMask = Boolean(maskLine);
  React.useEffect(() => {
    if (!open) return;
    const template = initialTemplate?.trim() ?? "";
    setChips(template.length > 0 ? templateToChips(template) : []);
    setRawTemplate(template);
    setAdvanced(template.length === 0 && !canMask);
    setPasteInput("");
    setPasteError(null);
    setPasting(false);
    setConflictError(null);
  }, [open, initialTemplate, canMask]);

  const template = advanced ? rawTemplate : chipsToTemplate(chips);
  const canSave = advanced
    ? canSavePattern(templateToChips(rawTemplate))
    : canSavePattern(chips);

  const createMutation = client.createPattern.useGatedMutation({
    gateInput: { streamId },
    onSuccess: (pattern) => {
      toast.success("Pattern created");
      onCreated?.(pattern.id);
      onOpenChange(false);
    },
    onError: (error) => {
      // A duplicate template is a friendly 409 - surface the server's message
      // inline rather than as a toast, right under the Save button.
      setConflictError(extractErrorMessage(error));
    },
  });

  const handleToggleChip = (index: number) => {
    setConflictError(null);
    setChips((current) => toggleChip(current, index));
  };

  const handlePaste = async () => {
    if (!maskLine) return;
    const body = pasteInput.trim();
    if (body.length === 0) {
      setPasteError("Paste a log line first.");
      return;
    }
    setPasting(true);
    setPasteError(null);
    try {
      const masked = await maskLine(body);
      setChips(templateToChips(masked));
      setPasteInput("");
    } catch (error) {
      setPasteError(extractErrorMessage(error));
    } finally {
      setPasting(false);
    }
  };

  const enterAdvanced = () => {
    setRawTemplate(chipsToTemplate(chips));
    setAdvanced(true);
  };
  const exitAdvanced = () => {
    setChips(templateToChips(rawTemplate));
    setAdvanced(false);
  };

  const handleSave = () => {
    if (!canSave) return;
    setConflictError(null);
    createMutation.mutate({ streamId, template: template.trim() });
  };

  const showPasteBox = !advanced && chips.length === 0 && Boolean(maskLine);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New pattern</DialogTitle>
          <DialogDescription>
            Click the parts of the line that vary between log lines - each one
            becomes a wildcard that matches any value. Saving classifies new
            lines from now on; existing lines are not reclassified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {advanced ? (
            <div className="space-y-1.5">
              <Label htmlFor="pattern-raw-template">Template</Label>
              <Textarea
                id="pattern-raw-template"
                value={rawTemplate}
                onChange={(e) => {
                  setRawTemplate(e.target.value);
                  setConflictError(null);
                }}
                rows={3}
                placeholder="user <*> logged in from <*>"
                className="font-mono text-xs"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Type the fixed skeleton and use{" "}
                <code className="rounded bg-surface-inset px-1">{WILDCARD}</code>{" "}
                for each part that varies.
              </p>
            </div>
          ) : showPasteBox ? (
            <div className="space-y-1.5">
              <Label htmlFor="pattern-paste">Paste a sample log line</Label>
              <Textarea
                id="pattern-paste"
                value={pasteInput}
                onChange={(e) => {
                  setPasteInput(e.target.value);
                  if (pasteError) setPasteError(null);
                }}
                rows={2}
                maxLength={MAX_PASTE_CHARS}
                placeholder="user 42 logged in from 10.0.0.1"
                className="font-mono text-xs"
                autoFocus
              />
              {pasteError && <FormError>{pasteError}</FormError>}
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handlePaste()}
                  disabled={pasting || pasteInput.trim().length === 0}
                >
                  <Wand2 className="size-4" />
                  {pasting ? "Reading line..." : "Turn into a pattern"}
                </Button>
              </div>
            </div>
          ) : chips.length > 0 ? (
            <ChipEditor chips={chips} onToggle={handleToggleChip} />
          ) : (
            <p className="rounded-md border bg-surface-inset p-3 text-sm text-muted-foreground">
              Switch to advanced mode below to author a template by hand.
            </p>
          )}

          {!showPasteBox && (
            <LivePreview
              streamId={streamId}
              template={template}
              enabled={canSave}
            />
          )}

          {conflictError && <FormError>{conflictError}</FormError>}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={advanced ? exitAdvanced : enterAdvanced}
          >
            {advanced ? "Back to guided" : "Advanced: edit the raw template"}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave || createMutation.isPending}
            >
              {createMutation.isPending ? "Saving..." : "Save pattern"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The clickable token chips. A literal toggles to a wildcard on click. */
function ChipEditor({
  chips,
  onToggle,
}: {
  chips: PatternChip[];
  onToggle: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 rounded-md border bg-surface-inset p-3">
        {chips.map((chip, index) => {
          const key = `${index}:${chip.text}`;
          if (chip.isVariable) {
            return (
              <button
                key={key}
                type="button"
                disabled={!chip.toggleable}
                onClick={() => onToggle(index)}
                title={
                  chip.toggleable
                    ? "Wildcard - click to make this a fixed word"
                    : "Detected as a value - always a wildcard"
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/15 px-2 py-1 font-mono text-xs text-primary transition-colors",
                  chip.toggleable
                    ? "cursor-pointer hover:bg-primary/25"
                    : "cursor-default",
                )}
              >
                <Sparkles className="size-3" aria-hidden />
                {chip.toggleable ? chip.text : "any value"}
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(index)}
              title="Click to make this a wildcard"
              className="inline-flex items-center rounded border bg-card px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-surface-inset"
            >
              {chip.text}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Highlighted parts are wildcards. Click any word to switch it between
        fixed and wildcard.
      </p>
    </div>
  );
}

/** Debounced live match preview against the newest lines of the stream. */
function LivePreview({
  streamId,
  template,
  enabled,
}: {
  streamId: string;
  template: string;
  enabled: boolean;
}) {
  const client = usePluginClient(LogstreamApi);
  const debounced = useDebouncedValue(template.trim(), PREVIEW_DEBOUNCE_MS);
  const active = enabled && debounced.length > 0;

  const { data, isFetching, isError } = client.testPattern.useQuery(
    { streamId, template: debounced, sampleLimit: PREVIEW_SAMPLE_LIMIT },
    { enabled: active, placeholderData: (prev) => prev },
  );

  if (!active) {
    return (
      <div className="rounded-md border bg-surface-inset p-3 text-xs text-muted-foreground">
        Mark at least one fixed word to preview matches.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-surface-inset p-3">
      {isError ? (
        <p className="text-xs text-muted-foreground">
          Preview is unavailable right now. You can still save the pattern.
        </p>
      ) : (
        <>
          <p className="text-xs font-medium text-foreground">
            {isFetching && !data
              ? "Checking recent lines..."
              : `Matches ${data?.matchCount ?? 0} of the last ${PREVIEW_SAMPLE_LIMIT} lines`}
          </p>
          {data && data.matchCount === 0 && (
            <p className="text-xs text-warning">
              Nothing recent matches yet. That is fine for a brand-new pattern -
              it starts classifying lines as they arrive.
            </p>
          )}
          {data && data.samples.length > 0 && (
            <div className="space-y-1">
              {data.samples.map((sample) => (
                <pre
                  key={sample.id}
                  className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
                >
                  {sample.body}
                </pre>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
