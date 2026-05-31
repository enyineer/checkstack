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

// ─── Secret-env test overrides ──────────────────────────────────────────────

const SECRET_TEMPLATE_RE = /\$\{\{\s*secrets\.([a-zA-Z0-9_-]+)\s*\}\}/g;
// A mapping value may legacy-carry a bare secret name instead of a template.
const BARE_SECRET_NAME_RE = /^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/;

/**
 * Derive the set of distinct secret NAMES referenced by a `secretEnv`
 * mapping (`{ ENV_NAME: "${{ secrets.NAME }}" }`). Tolerates a legacy bare
 * secret name as a value too. Order-stable (first-seen) so the override UI
 * renders deterministically. Returns `[]` when the mapping is absent/empty.
 */
export function distinctSecretNames(
  secretEnv: Record<string, string> | undefined,
): string[] {
  if (!secretEnv) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  for (const value of Object.values(secretEnv)) {
    SECRET_TEMPLATE_RE.lastIndex = 0;
    let matched = false;
    let match: RegExpExecArray | null;
    while ((match = SECRET_TEMPLATE_RE.exec(value)) !== null) {
      matched = true;
      add(match[1]);
    }
    if (!matched) {
      const bare = BARE_SECRET_NAME_RE.exec(value);
      if (bare) add(bare[1]);
    }
  }
  return out;
}

/**
 * Build the `secretOverrides` payload sent to the test endpoint from the
 * user's per-secret-NAME draft inputs. Drops blank entries (an empty
 * override means "use the placeholder") and keeps only names actually
 * referenced by the mapping, so a stale draft can't inject an unreferenced
 * value. Returns `undefined` when nothing is overridden so the wire stays
 * clean.
 */
export function buildSecretOverrides({
  secretEnv,
  drafts,
}: {
  secretEnv: Record<string, string> | undefined;
  drafts: Record<string, string>;
}): Record<string, string> | undefined {
  const names = distinctSecretNames(secretEnv);
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = drafts[name];
    if (value !== undefined && value.length > 0) {
      out[name] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
