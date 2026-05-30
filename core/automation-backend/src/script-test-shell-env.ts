/**
 * Flatten a sample test context into the `CHECKSTACK_*` environment
 * variables a `run_shell` script receives.
 *
 * Mirrors `flattenScopeToShellEnv` in `@checkstack/integration-script-backend`
 * (which operates on a real `ActionRunScope`) but works on the editable
 * {@link ScriptTestContext} the test panel sends. Names are produced via the
 * shared {@link toShellEnvKey} rule so the injected vars match the editor's
 * `$` autocomplete suggestions exactly.
 */
import { toShellEnvKey } from "@checkstack/automation-common";
import type { ScriptTestContext } from "./script-test";

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
    out[toShellEnvKey(path)] = value
      .map((element) =>
        isScalar(element) ? String(element) : JSON.stringify(element),
      )
      .join("\n");
    for (const [index, element] of value.entries()) {
      flattenInto(element, `${path}[${index}]`, out);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      flattenInto(child, `${path}.${key}`, out);
    }
    return;
  }
}

/**
 * Build the `CHECKSTACK_*` env var map for a shell test run from the
 * editable sample context. Paths mirror the editor's scope field paths
 * (`trigger.event`, `trigger.payload.*`, `artifact.<type>.*`, `var.*`,
 * `repeat.*`).
 */
export function flattenScopeToShellEnv(
  context: ScriptTestContext | undefined,
): Record<string, string> {
  const out: Record<string, string> = {
    [toShellEnvKey("trigger.event")]: context?.trigger?.event ?? "",
  };

  flattenInto(context?.trigger?.payload ?? {}, "trigger.payload", out);

  for (const [type, data] of Object.entries(context?.artifacts ?? {})) {
    flattenInto(data, `artifact.${type}`, out);
  }
  for (const [name, value] of Object.entries(context?.var ?? {})) {
    flattenInto(value, `var.${name}`, out);
  }
  if (context?.repeat) {
    out[toShellEnvKey("repeat.index")] = String(context.repeat.index);
    if (context.repeat.item !== undefined) {
      flattenInto(context.repeat.item, "repeat.item", out);
    }
  }

  return out;
}
