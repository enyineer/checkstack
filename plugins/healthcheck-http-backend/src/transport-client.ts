import type { TransportClient } from "@checkstack/common";

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
}

/**
 * HTTP transport client for collector execution.
 * Each exec() performs a fresh HTTP request.
 */
export type HttpTransportClient = TransportClient<HttpRequest, HttpResponse>;
