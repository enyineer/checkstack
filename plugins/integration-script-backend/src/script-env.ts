/**
 * Flatten an automation run scope into the environment variables a
 * `run_shell` script receives.
 *
 * Shell scripts access run context via `$CHECKSTACK_*` env vars (not
 * `{{ }}` templates). This walks the scope and emits one var per scalar
 * leaf, named via the shared {@link toShellEnvKey} rule so the editor's
 * `$` autocomplete lists exactly the names injected here. Objects recurse
 * into nested keys; arrays become a single newline-separated var at their
 * key (iterate with `while IFS= read -r x`) AND are additionally indexed
 * per element (`..._0`, `..._1`, `..._0_<field>`) to match the editor's
 * array-element suggestions. Everything is a plain string var — there's no
 * JSON blob, since the container has no `jq` to parse it.
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
 * path. Plain objects recurse; arrays emit a single newline-separated var
 * at the current path AND recurse into each element by numeric index.
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
    // array's own path, matching the editor's whole-array `$` suggestion.
    out[toShellEnvKey(path)] = value
      .map((element) => (isScalar(element) ? String(element) : JSON.stringify(element)))
      .join("\n");
    // ADDITIONALLY index each element by position so scalar arrays expose
    // `..._0`, `..._1`, … and object-element arrays expose
    // `..._0_<FIELD>`. The editor suggests array elements using index 0 as
    // the representative (`tags[0]`, `comments[0].author`), and
    // `toShellEnvKey` collapses `[i]` to `_<i>_`, so recursing here keeps
    // the injected names byte-identical to those suggestions (editor
    // parity). Recursion terminates because each step strips one array /
    // object level, so nested arrays-of-arrays sanely yield `..._0_0`.
    for (const [index, element] of value.entries()) {
      flattenInto(element, `${path}[${index}]`, out);
    }
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
