/**
 * Pure normalization of an SNMP varbind (as delivered by `net-snmp`) into the
 * plain, assertable shape the collector exposes. Kept free of `net-snmp` and of
 * any socket so it is unit-testable in isolation - the socket-bound glue lives
 * in {@link ./snmp-session}.
 *
 * The SMI/ASN.1 type tags below mirror `net-snmp`'s `ObjectType` numeric values
 * (a stable IANA standard); we inline them so this module carries no runtime
 * dependency on the library.
 */

/** SMI / ASN.1 type tags for the SNMP value types we surface. */
export const SnmpType = {
  Boolean: 1,
  Integer: 2,
  OctetString: 4,
  Null: 5,
  OID: 6,
  IpAddress: 64,
  Counter32: 65,
  Gauge32: 66,
  TimeTicks: 67,
  Opaque: 68,
  Counter64: 70,
  NoSuchObject: 128,
  NoSuchInstance: 129,
  EndOfMibView: 130,
} as const;

/** Human-readable name per type tag, used for the assertable `valueType`. */
const TYPE_NAMES: Record<number, string> = {
  [SnmpType.Boolean]: "Boolean",
  [SnmpType.Integer]: "Integer",
  [SnmpType.OctetString]: "OctetString",
  [SnmpType.Null]: "Null",
  [SnmpType.OID]: "OID",
  [SnmpType.IpAddress]: "IpAddress",
  [SnmpType.Counter32]: "Counter32",
  [SnmpType.Gauge32]: "Gauge32",
  [SnmpType.TimeTicks]: "TimeTicks",
  [SnmpType.Opaque]: "Opaque",
  [SnmpType.Counter64]: "Counter64",
  [SnmpType.NoSuchObject]: "noSuchObject",
  [SnmpType.NoSuchInstance]: "noSuchInstance",
  [SnmpType.EndOfMibView]: "endOfMibView",
};

/** The "exception" varbinds: the agent answered, but has no such value. */
const EXCEPTION_TYPES = new Set<number>([
  SnmpType.NoSuchObject,
  SnmpType.NoSuchInstance,
  SnmpType.EndOfMibView,
]);

/**
 * A raw varbind as produced by `net-snmp`: an ASN.1 `type` tag plus a `value`
 * that is a `number` (Integer / Counter / Gauge / TimeTicks), a `string`
 * (OID / IpAddress), a `boolean`, `null` (exception / Null), or a `Buffer`
 * (OctetString / Opaque / Counter64).
 */
export interface RawSnmpVarbind {
  type: number;
  value: unknown;
}

/** The normalized, assertable form of a varbind. */
export interface NormalizedVarbind {
  /** SNMP type name (e.g. `Counter64`) or exception sentinel. */
  typeName: string;
  /**
   * Numeric value when representable as a JS number. For `Counter64` this is a
   * best-effort `Number(...)` conversion that MAY lose integer precision above
   * 2^53 - {@link NormalizedVarbind.stringValue} keeps the exact value.
   */
  numericValue?: number;
  /** Lossless string rendering (always present). */
  stringValue: string;
}

/** True for a `Buffer` / `Uint8Array` payload. */
function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/** Big-endian byte buffer -> BigInt (handles any length, including empty). */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Normalize a raw `net-snmp` varbind into an assertable {@link NormalizedVarbind}.
 * Never throws: every completed response - including exception varbinds and
 * out-of-JS-range Counter64 values - maps to a value, so it is the collector's
 * assertions (not a hard failure) that decide health.
 */
export function normalizeVarbind({
  type,
  value,
}: RawSnmpVarbind): NormalizedVarbind {
  const typeName = TYPE_NAMES[type] ?? `Type(${type})`;

  // Exception varbinds are a COMPLETED response, not a transport failure.
  if (EXCEPTION_TYPES.has(type)) {
    return { typeName, stringValue: typeName };
  }

  // Counter64 arrives as an 8-byte big-endian buffer. Preserve the exact value
  // as a string; expose a best-effort Number for charting / anomaly detection.
  if (type === SnmpType.Counter64 && isBytes(value)) {
    const big = bytesToBigInt(value);
    const asNumber = Number(big);
    return {
      typeName,
      stringValue: big.toString(),
      numericValue: Number.isFinite(asNumber) ? asNumber : undefined,
    };
  }

  // OctetString / Opaque arrive as a buffer; render to text.
  if (isBytes(value)) {
    return { typeName, stringValue: Buffer.from(value).toString("utf8") };
  }

  if (typeof value === "number") {
    return { typeName, numericValue: value, stringValue: String(value) };
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return {
      typeName,
      stringValue: value.toString(),
      numericValue: Number.isFinite(asNumber) ? asNumber : undefined,
    };
  }

  if (typeof value === "boolean") {
    return { typeName, numericValue: value ? 1 : 0, stringValue: String(value) };
  }

  if (value === null || value === undefined) {
    return { typeName, stringValue: "" };
  }

  // OID / IpAddress (string) and any other scalar.
  return { typeName, stringValue: String(value) };
}
