import type { TransportClient } from "@checkstack/common";

/**
 * Ping request.
 */
export interface PingRequest {
  host: string;
  count: number;
  timeout: number;
}

/**
 * Ping result.
 */
export interface PingResult {
  packetsSent: number;
  packetsReceived: number;
  packetLoss: number;
  minLatency?: number;
  avgLatency?: number;
  maxLatency?: number;
  error?: string;
}

/**
 * Ping transport client for ICMP checks.
 */
export type PingTransportClient = TransportClient<PingRequest, PingResult>;
