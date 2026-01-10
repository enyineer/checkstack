import type { TransportClient } from "@checkstack/common";

/**
 * TCP connection request.
 */
export interface TcpConnectRequest {
  /** Action type */
  type: "connect" | "read";
  /** Timeout for banner read (optional) */
  timeout?: number;
}

/**
 * TCP connection result.
 */
export interface TcpConnectResult {
  connected: boolean;
  banner?: string;
  error?: string;
}

/**
 * TCP transport client for connection checks.
 */
export type TcpTransportClient = TransportClient<
  TcpConnectRequest,
  TcpConnectResult
>;
