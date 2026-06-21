import type { TransportClient } from "@checkstack/common";
import type { TransportTimings } from "@checkstack/backend-api";

/**
 * HTTP request configuration.
 */
export interface HttpRequest {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

/**
 * HTTP response result.
 */
export interface HttpResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  contentType?: string;
  /**
   * Structured transport timing breakdown for this request (DNS / connect /
   * TLS / wait / transfer), populated by the instrumented node-http client.
   * Absent if the request never produced socket events.
   */
  timings?: TransportTimings;
}

/**
 * HTTP transport client for collector execution.
 * Each exec() performs a fresh HTTP request.
 */
export type HttpTransportClient = TransportClient<HttpRequest, HttpResponse>;
