import type { TransportClient } from "@checkstack/common";

/**
 * Script execution request.
 */
export interface ScriptRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
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
 * Script transport client for command execution.
 */
export type ScriptTransportClient = TransportClient<
  ScriptRequest,
  ScriptResult
>;
