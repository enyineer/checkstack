import { extractErrorMessage } from "@checkstack/common";

/**
 * Pure logic for the script-test panel, extracted so it can be unit-tested
 * without rendering Monaco. The React component in `ScriptTestPanel.tsx`
 * consumes these.
 */

/** Result of a single in-UI script test run (UI-side shape). */
export interface ScriptTestPanelResult {
  result?: unknown;
  stdout: string;
  stderr: string;
  exitCode?: number;
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

/** A run is a failure if it errored or timed out. */
export function isFailedResult(result: ScriptTestPanelResult): boolean {
  return result.error !== undefined || result.timedOut;
}

/** Pretty-print a script's return value for display. */
export function formatReturnValue(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * True when a result has nothing to show in the detail body (no error,
 * no return value, no stdout/stderr) - the panel shows "No output." then.
 */
export function hasNoOutput(result: ScriptTestPanelResult): boolean {
  return (
    result.error === undefined &&
    result.result === undefined &&
    result.stdout.length === 0 &&
    result.stderr.length === 0
  );
}

/**
 * Validate the editable sample-context JSON. Returns the parse error
 * message, or `null` when the value is empty or valid JSON.
 */
export function validateSampleContextJson(value: string): string | null {
  if (value.trim().length === 0) return null;
  try {
    JSON.parse(value);
    return null;
  } catch (error) {
    return extractErrorMessage(error, "Invalid JSON");
  }
}

/** Build the failure result the panel shows when `onRun` rejects. */
export function rejectionResult(error: unknown): ScriptTestPanelResult {
  return {
    stdout: "",
    stderr: "",
    durationMs: 0,
    timedOut: false,
    error: extractErrorMessage(error),
  };
}
