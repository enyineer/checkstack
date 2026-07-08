import type { TransportClient } from "@checkstack/common";

/**
 * A single SNMP GET operation: which OID to read from the already-connected
 * session. The host / port / credentials are baked into the session by the
 * strategy's `createClient`, so a request only carries the operation itself
 * (mirrors the Redis `RedisCommand` shape).
 */
export interface SnmpRequest {
  /** Object identifier to read, e.g. `1.3.6.1.2.1.1.3.0` (sysUpTime). */
  oid: string;
}

/**
 * Result of an SNMP GET.
 *
 * The SNMP agent RESPONDING is a completed probe - even when it answers with a
 * numeric value that is "out of range", a string, or an exception varbind
 * (`noSuchObject` / `noSuchInstance` / `endOfMibView`). All of those are
 * assertable metrics, NOT transport failures. `error` is reserved for the probe
 * failing to complete (socket unreachable, timeout, v3 auth handshake failure).
 */
export interface SnmpResult {
  /**
   * The numeric value of the varbind when it is representable as a JS number
   * (Integer / Counter / Gauge / TimeTicks, and a best-effort conversion of
   * Counter64). Absent for string / exception values.
   */
  value?: number;
  /**
   * Lossless string rendering of the returned value. Present for every
   * completed response (numeric, string, IP, OID, or exception sentinel), so a
   * Counter64 that exceeds JS safe-integer range is still asserted exactly.
   */
  valueString?: string;
  /**
   * The SNMP type name of the varbind (e.g. `Integer`, `Counter64`,
   * `OctetString`) or the exception sentinel (`noSuchObject`,
   * `noSuchInstance`, `endOfMibView`). `"error"` on a transport failure.
   */
  valueType: string;
  /** Round-trip time of the GET in milliseconds. */
  responseTimeMs: number;
  /** Set ONLY when the probe could not complete (transport failure). */
  error?: string;
}

/**
 * SNMP transport client for collector execution.
 */
export type SnmpTransportClient = TransportClient<SnmpRequest, SnmpResult>;
