import React from "react";
import {
  Play,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  FlaskConical,
} from "lucide-react";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { CodeEditor } from "./CodeEditor";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";
import {
  type ScriptTestPanelResult,
  formatReturnValue,
  hasNoOutput,
  isFailedResult,
  rejectionResult,
  validateSampleContextJson,
} from "./ScriptTestPanel.logic";

/**
 * Result of a single in-UI script test run. Plugin-agnostic shape mirroring
 * the backend `testScript` / `testCollectorScript` output so the panel can
 * be reused by any script field (automation actions, healthcheck collectors,
 * future surfaces). Re-exported from the pure-logic module so the public
 * type stays at this path.
 */
export type { ScriptTestPanelResult } from "./ScriptTestPanel.logic";

export interface ScriptTestPanelProps {
  /**
   * Runs the test. The owning feature page supplies this; it typically
   * calls the plugin's `testScript` RPC with the current script + sample
   * context and resolves with the result. Rejecting surfaces as an error.
   */
  onRun: () => Promise<ScriptTestPanelResult>;
  /** Disables the Run button (e.g. while the script field is empty). */
  disabled?: boolean;
  /**
   * Editable sample-context slot. Render a {@link ContextSampleEditor} (or
   * any control) here; the panel just lays it out above the results.
   */
  contextEditor?: React.ReactNode;
  /**
   * Note shown under the Run button. Defaults to the central-execution
   * caveat. Pass `null` to hide it.
   */
  note?: React.ReactNode;
  /**
   * Whether the panel is expanded on first render. Defaults to `false`
   * so a compact "Test script" affordance shows under every testable
   * field and the sample-context editor + results only mount on demand.
   * A successful/failed run auto-expands regardless of this.
   */
  defaultOpen?: boolean;
  className?: string;
}

const DEFAULT_NOTE =
  "Runs on the central backend. Real satellite runs may differ.";

/**
 * Inline script test panel: a Run button plus collapsible results
 * (return value / stdout / stderr / exit code / duration / error).
 *
 * Purely presentational - it owns no RPC. The owning page wires `onRun`
 * to the appropriate `testScript` mutation. Appears beneath any
 * `x-script-testable` field via `MultiTypeEditorField`.
 */
export const ScriptTestPanel: React.FC<ScriptTestPanelProps> = ({
  onRun,
  disabled,
  contextEditor,
  note = DEFAULT_NOTE,
  defaultOpen = false,
  className,
}) => {
  const { isLowPower } = usePerformance();
  const [running, setRunning] = React.useState(false);
  // Whole-panel disclosure: collapsed by default so a testable field shows
  // only a compact "Test script" affordance and the sample-context editor +
  // results mount on demand. A run forces it open.
  const [panelOpen, setPanelOpen] = React.useState(defaultOpen);
  const [resultExpanded, setResultExpanded] = React.useState(true);
  const [result, setResult] = React.useState<ScriptTestPanelResult | null>(null);

  const handleRun = React.useCallback(async () => {
    setRunning(true);
    try {
      const res = await onRun();
      setResult(res);
      setResultExpanded(true);
    } catch (error) {
      setResult(rejectionResult(error));
      setResultExpanded(true);
    } finally {
      setRunning(false);
    }
  }, [onRun]);

  const failed = result !== null && isFailedResult(result);

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-muted/20",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setPanelOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        aria-expanded={panelOpen}
      >
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <FlaskConical className="h-3.5 w-3.5" />
          Test script
          {/* When collapsed, surface the last run's outcome as a hint. */}
          {!panelOpen && result !== null && (
            <Badge
              variant={failed ? "destructive" : "secondary"}
              className="font-normal normal-case"
            >
              {failed ? "Failed" : "Success"}
            </Badge>
          )}
        </span>
        {panelOpen ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {panelOpen && (
        <div className="space-y-3 border-t border-border/60 p-3">
          <div className="flex items-center justify-end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleRun}
              disabled={disabled || running}
            >
              <Play
                className={cn(
                  "h-3.5 w-3.5",
                  running && !isLowPower && "animate-pulse",
                )}
              />
              {running ? "Running…" : "Run"}
            </Button>
          </div>

          {contextEditor}

          {note !== null && (
            <p className="text-xs text-muted-foreground">{note}</p>
          )}

          {result !== null && (
            <div className="rounded-md border border-border bg-card">
              <button
                type="button"
                onClick={() => setResultExpanded((prev) => !prev)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  {failed ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  )}
                  {failed ? "Failed" : "Success"}
                  <Badge variant="secondary" className="font-normal">
                    {result.durationMs}ms
                  </Badge>
                  {result.exitCode !== undefined && (
                    <Badge variant="secondary" className="font-normal">
                      exit {result.exitCode}
                    </Badge>
                  )}
                </span>
                {resultExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {resultExpanded && (
                <div className="space-y-3 border-t border-border px-3 py-3">
                  {result.error !== undefined && (
                    <ResultBlock
                      label="Error"
                      tone="error"
                      value={result.error}
                    />
                  )}
                  {result.result !== undefined && (
                    <ResultBlock
                      label="Return value"
                      value={formatReturnValue(result.result)}
                    />
                  )}
                  {result.stdout.length > 0 && (
                    <ResultBlock label="stdout" value={result.stdout} />
                  )}
                  {result.stderr.length > 0 && (
                    <ResultBlock
                      label="stderr"
                      tone="error"
                      value={result.stderr}
                    />
                  )}
                  {hasNoOutput(result) && (
                    <p className="text-xs italic text-muted-foreground">
                      No output.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ResultBlock: React.FC<{
  label: string;
  value: string;
  tone?: "error";
}> = ({ label, value, tone }) => (
  <div className="space-y-1">
    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
    <pre
      className={cn(
        "max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-words",
        tone === "error" && "text-destructive",
      )}
    >
      {value}
    </pre>
  </div>
);

// ─── Context sample editor ──────────────────────────────────────────────────

export interface ContextSampleEditorProps {
  /** Current sample-context JSON string. */
  value: string;
  onChange: (value: string) => void;
  /** Label above the editor. Defaults to "Sample context". */
  label?: string;
  disabled?: boolean;
  /**
   * Optional control rendered on the label row, e.g. a "Load from run"
   * dropdown. The owning page supplies it (it owns the replay RPC); the
   * editor stays plugin-agnostic and just lays it out.
   */
  runPicker?: React.ReactNode;
}

/**
 * Editable JSON sample-context editor for the test panel. Auto-seeding
 * (from the field's schema / IntelliSense context) is the owning page's
 * job - this component just renders + validates the JSON the user edits.
 *
 * Surfaces a parse error inline so an operator can fix malformed JSON
 * before running. The optional `runPicker` slot lets a page add a "Load
 * from run" dropdown that overwrites the sample with a real run's scope.
 */
export const ContextSampleEditor: React.FC<ContextSampleEditorProps> = ({
  value,
  onChange,
  label = "Sample context",
  disabled,
  runPicker,
}) => {
  const parseError = React.useMemo(
    () => validateSampleContextJson(value),
    [value],
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {runPicker}
      </div>
      <CodeEditor
        value={value}
        onChange={onChange}
        language="json"
        minHeight="120px"
        readOnly={disabled}
      />
      {parseError !== null && (
        <p className="text-xs text-destructive">Invalid JSON: {parseError}</p>
      )}
    </div>
  );
};
