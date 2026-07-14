---
"@checkstack/otlp-wire": patch
---

Fix OTLP `AnyValue` int64 decoding: the varint is now interpreted as SIGNED
64-bit two's complement (a negative attribute previously surfaced as a huge
positive float), and magnitudes beyond JavaScript's safe-integer range keep
their exact decimal string instead of silently rounding (matching proto3-JSON,
where int64 is a string on the wire for the same reason).
