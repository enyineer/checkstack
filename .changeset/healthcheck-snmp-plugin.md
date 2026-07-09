---
"@checkstack/healthcheck-snmp-backend": minor
---

Add an SNMP health-check plugin (strategy id `snmp`, collector id `snmp`) in the
networking category. It queries a single OID from an SNMP v1 / v2c / v3 agent and
exposes the returned value (`value` numeric, `valueString` lossless),
`valueType`, and `responseTimeMs` as assertable metrics. Connection details and
credentials (community string, v3 auth/priv keys) live on the strategy config as
extracted secrets. Following the collector contract, only a genuine transport
failure (unreachable socket, timeout, v3 auth handshake failure) sets `error`;
returned values and the SNMP exception varbinds (`noSuchObject`,
`noSuchInstance`, `endOfMibView`) are completed responses you assert on.
Counter64 values that exceed JS safe-integer range are preserved exactly in
`valueString` and never crash the collector.

Thanks to [@stuajnht](https://github.com/stuajnht) for the valuable feedback.
