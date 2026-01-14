import type { TransportClient } from "@checkstack/common";

// ============================================================================
// RCON TRANSPORT TYPES
// ============================================================================

/**
 * RCON command execution result.
 */
export interface RconResult {
  /** Response text from the RCON command */
  response: string;
}

/**
 * RCON transport client type.
 * Commands are strings (RCON commands), results include the response text.
 */
export type RconTransportClient = TransportClient<string, RconResult>;
