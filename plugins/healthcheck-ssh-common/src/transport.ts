import type { TransportClient } from "@checkstack/common";

// ============================================================================
// SSH TRANSPORT TYPES
// ============================================================================

/**
 * SSH command execution result.
 */
export interface SshResult {
  /** Exit code from the command (0 = success) */
  exitCode: number;
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
}

/**
 * SSH transport client type.
 * Commands are strings (shell commands), results include exit code and output.
 */
export type SshTransportClient = TransportClient<string, SshResult>;
