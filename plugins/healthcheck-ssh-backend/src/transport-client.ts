import type { TransportClient } from "@checkstack/common";

/**
 * SSH command result from remote execution.
 */
export interface SshCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * SSH transport client for collector execution.
 * Implements the generic TransportClient interface with SSH command execution.
 */
export type SshTransportClient = TransportClient<string, SshCommandResult>;

// Re-export for convenience
export type { TransportClient } from "@checkstack/common";
