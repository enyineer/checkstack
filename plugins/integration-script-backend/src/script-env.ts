/**
 * Flatten an automation run scope into the environment variables a
 * `run_shell` script receives.
 *
 * Shell scripts access run context via `$CHECKSTACK_*` env vars (not
 * `{{ }}` templates). This walks the scope and emits one var per scalar
 * leaf, named via the shared {@link toShellEnvKey} rule so the editor's
 * `$` autocomplete lists exactly the names injected here. Objects recurse
 * into nested keys; arrays become a single newline-separated var at their
 * key (iterate with `while IFS= read -r x`). Everything is a plain string
 * var — there's no JSON blob, since the container has no `jq` to parse it.
 */
import type { ActionRunScope } from "@checkstack/automation-backend";
import { toShellEnvKey } from "@checkstack/automation-common";

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Walk a value, writing one env var per scalar leaf keyed by its dotted
 * path. Plain objects recurse; arrays become a single newline-separated
 * var at the current path.
 */
function flattenInto(
  value: unknown,
  path: string,
  out: Record<string, string>,
): void {
  if (isScalar(value)) {
    out[toShellEnvKey(path)] = String(value);
    return;
  }
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    // The container has no `jq`, so an array becomes a single
    // newline-separated var (iterate with `while IFS= read -r x; do …;
    // done <<< "$VAR"`). Scalar elements are joined directly; non-scalar
    // elements (rare) fall back to JSON per line. The key stays the
    // array's own path, matching the editor's `$` suggestion for it.
    out[toShellEnvKey(path)] = value
      .map((element) => (isScalar(element) ? String(element) : JSON.stringify(element)))
      .join("\n");
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenInto(child, `${path}.${key}`, out);
    }
    return;
  }
}

/**
 * Build the `CHECKSTACK_*` env var map for a shell script run from the
 * action run scope. Paths mirror the editor's scope field paths
 * (`trigger.event`, `trigger.payload.*`, `artifact.<type>.*`, `var.*`,
 * `repeat.*`) so injected names match the editor's `$` suggestions.
 */
export function flattenScopeToShellEnv(
  scope: ActionRunScope,
): Record<string, string> {
  const out: Record<string, string> = {
    [toShellEnvKey("trigger.event")]: scope.trigger.event,
  };

  flattenInto(scope.trigger.payload, "trigger.payload", out);

  for (const [type, data] of Object.entries(scope.artifacts)) {
    flattenInto(data, `artifact.${type}`, out);
  }
  for (const [name, value] of Object.entries(scope.vars)) {
    flattenInto(value, `var.${name}`, out);
  }
  if (scope.repeat) {
    out[toShellEnvKey("repeat.index")] = String(scope.repeat.index);
    if (scope.repeat.item !== undefined) {
      flattenInto(scope.repeat.item, "repeat.item", out);
    }
  }

  return out;
}
