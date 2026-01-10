import type { TransportClient } from "@checkstack/common";

/**
 * gRPC health check request.
 */
export interface GrpcHealthRequest {
  service: string;
}

/**
 * gRPC health check response.
 */
export interface GrpcHealthResponse {
  status: "UNKNOWN" | "SERVING" | "NOT_SERVING" | "SERVICE_UNKNOWN";
  error?: string;
}

/**
 * gRPC transport client for health checks.
 */
export type GrpcTransportClient = TransportClient<
  GrpcHealthRequest,
  GrpcHealthResponse
>;
