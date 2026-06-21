---
"@checkstack/satellite-backend": minor
---

fix(satellite-backend): authorize satellite result messages per assignment

A satellite's `result` message is now authorized against the satellite's actual
assignment set, not just authenticated. The core accepts a result only when its
`(configId, systemId)` pair is in the satellite's current assignments; an
out-of-scope result is logged and dropped without closing the connection.

Previously the WebSocket handshake authenticated WHICH satellite was connected
but never authorized WHAT it could report for, so a compromised or malicious
satellite could forge health data for any system (suppress a real outage, raise
false alarms, or inject payloads into charts and aggregates). The authorization
set is seeded on connect and refreshed on every assignment push, so a
reassignment takes effect immediately.
