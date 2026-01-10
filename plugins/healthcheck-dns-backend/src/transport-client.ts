import type { TransportClient } from "@checkstack/common";

/**
 * DNS lookup request.
 */
export interface DnsLookupRequest {
  hostname: string;
  recordType: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS";
}

/**
 * DNS lookup result.
 */
export interface DnsLookupResult {
  values: string[];
  error?: string;
}

/**
 * DNS transport client for record lookups.
 */
export type DnsTransportClient = TransportClient<
  DnsLookupRequest,
  DnsLookupResult
>;
