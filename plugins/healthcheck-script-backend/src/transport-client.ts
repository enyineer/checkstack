import type { TransportClient } from "@checkstack/common";

/**
 * Script execution request.
 *
 * The {@link script} field is interpreted by the host shell via `sh -c`,
 * so it can contain pipes, redirects, variable expansion, command substitution,
 * `if` / `for` / `while` blocks, etc. — anything POSIX `sh` understands.
 */
export interface ScriptRequest {
  /** Shell script source. Executed via `sh -c <script>`. */
  script: string;
  /** Optional working directory. */
  cwd?: string;
  /** Optional extra environment variables (merged on top of the safe-vars whitelist). */
  env?: Record<string, string>;
  /** Maximum execution time in milliseconds. */
  timeout: number;
}

/**
 * Script execution result.
 */
export interface ScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

/**
 * Script transport client for shell-script execution.
 */
export type ScriptTransportClient = TransportClient<
  ScriptRequest,
  ScriptResult
>;
