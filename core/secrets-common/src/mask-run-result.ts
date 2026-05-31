import { maskSecrets, maskSecretsDeep } from "./masking";

/**
 * The captured output of a script/shell run — the central shape produced
 * by the script runners and surfaced to users (automation
 * `run_script`/`run_shell` artifacts, the in-UI test panel, healthcheck
 * collectors). Masking is applied to EVERY field that can carry a secret
 * the run was given.
 */
export interface ScriptRunOutput {
  result?: unknown;
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Redact every literal occurrence of the run's resolved secret `values`
 * out of a script run's output before it is persisted or returned. This is
 * the central, reusable leak-masking seam: callers pass the run-scoped,
 * least-privilege value set (only that run's resolved secrets).
 *
 * `result` (an arbitrary JSON value) is masked deeply (keys + string
 * leaves); `stdout`/`stderr`/`error` are masked as text. With an empty
 * `values` set the output is returned unchanged (no resolved secrets to
 * redact).
 */
export function maskScriptRunOutput<T extends ScriptRunOutput>({
  output,
  values,
}: {
  output: T;
  values: Iterable<string>;
}): T {
  const valueArray = [...values];
  if (valueArray.length === 0) {
    return output;
  }
  return {
    ...output,
    ...(output.result === undefined
      ? {}
      : { result: maskSecretsDeep({ value: output.result, values: valueArray }) }),
    stdout: maskSecrets({ text: output.stdout, values: valueArray }),
    stderr: maskSecrets({ text: output.stderr, values: valueArray }),
    ...(output.error === undefined
      ? {}
      : { error: maskSecrets({ text: output.error, values: valueArray }) }),
  };
}
