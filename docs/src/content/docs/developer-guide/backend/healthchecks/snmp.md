---
title: "SNMP health check"
description: "Query an SNMP agent OID with the SNMP strategy and collector, and assert on the returned value, type, and response time."
---

The SNMP health check reads a single OID from an SNMP agent and exposes the returned value, its SNMP type, and the round-trip time as assertable metrics. It ships as the `@checkstack/healthcheck-snmp-backend` plugin (strategy id `snmp`, collector id `snmp`) and sits in the `networking` strategy category. It supports SNMP v1, v2c, and v3.

## Configuration

The strategy owns the connection to the agent (target and credentials); the collector owns the operation (which OID to read). Community strings and v3 keys are declared with `configSecret`, so they are extracted, redacted on read, and resolved at run time rather than stored in plaintext.

Strategy config (connection):

```ts
{
  host: "10.0.0.10",        // agent hostname or IP
  port: 161,                 // SNMP UDP port (default 161)
  version: "2c",            // "1" | "2c" | "3"
  community: "public",      // secret, used for v1 / v2c
  // v3 only:
  v3Username: "monitor",
  v3SecurityLevel: "authPriv", // noAuthNoPriv | authNoPriv | authPriv
  v3AuthProtocol: "sha",       // md5 | sha | sha224 | sha256 | sha384 | sha512
  v3AuthKey: "…",              // secret
  v3PrivProtocol: "aes",       // des | aes | aes256b | aes256r
  v3PrivKey: "…",              // secret
  timeout: 5000
}
```

Collector config (operation):

```ts
{
  oid: "1.3.6.1.2.1.1.3.0" // e.g. sysUpTime
}
```

## Result metrics

Each run returns:

- `value` - the numeric value of the varbind when it is representable as a JS number (Integer, Counter, Gauge, TimeTicks, and a best-effort conversion of Counter64). Absent for string or exception values. Anomaly detection watches for a two-sided `deviation` from the learned baseline.
- `valueString` - a lossless string rendering of the value, present for every completed response. This carries Counter64 values that exceed JS safe-integer range exactly, plus non-numeric OctetString / OID / IP values.
- `valueType` - the SNMP type name (`Integer`, `Counter64`, `OctetString`, ...) or an exception sentinel (`noSuchObject`, `noSuchInstance`, `endOfMibView`).
- `responseTimeMs` - the GET round-trip time.

Write assertions against these fields, for example `value greater-than 0` or `valueType equals Integer`.

## Transport failure versus assertable metric

The SNMP collector follows the platform rule that a collector fails ONLY when the probe could not complete. See [Collector plugin development](/checkstack/developer-guide/backend/healthchecks/collectors/) for the full contract.

- A returned value, and the SNMP exception varbinds `noSuchObject`, `noSuchInstance`, and `endOfMibView`, are COMPLETED responses. They land in the result as `valueType` / `valueString` metrics you assert on. They never set `error`.
- Only a genuine transport failure sets `error`: an unreachable socket, a request timeout or abort, or a v3 authentication handshake that cannot complete.

A value that merely looks "out of range" is decided by your assertions (and, separately, by the anomaly engine), not by the collector hard-failing.

## Counter64 handling

Counter64 values arrive from the agent as an 8-byte big-endian buffer. The plugin preserves the exact value in `valueString` (lossless, so a value above 2^53 is asserted precisely) and exposes a best-effort `Number` in `value` for charting and anomaly detection. The numeric form may lose integer precision above 2^53; assert on `valueString` when you need exactness. Conversion never throws.
