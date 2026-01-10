import type { TransportClient } from "@checkstack/common";

/**
 * Redis command for transport client.
 */
export interface RedisCommand {
  cmd: "PING" | "INFO" | "GET" | "SET" | "KEYS" | "CUSTOM";
  args?: string[];
}

/**
 * Redis command result.
 */
export interface RedisCommandResult {
  value: string | undefined;
  error?: string;
}

/**
 * Redis transport client for collector execution.
 */
export type RedisTransportClient = TransportClient<
  RedisCommand,
  RedisCommandResult
>;
