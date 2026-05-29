---
"@checkstack/satellite-backend": minor
---

feat(satellite): Phase 9 — connection lifecycle triggers

- New hooks `satelliteHooks.connected`, `satelliteHooks.disconnected`,
  and `satelliteHooks.heartbeatLost`. `connected` and `disconnected`
  fire from the WS handler at auth completion and `onClose`
  respectively; `heartbeatLost` fires from the heartbeat monitor on
  the `online → offline` edge only (the opposite edge is observable
  via `connected`).
- Triggers `satellite.connected`, `satellite.disconnected`,
  `satellite.heartbeat_lost` registered against the Automation
  Platform. All carry `contextKey: (p) => p.satelliteId` so a
  long-running automation can resume on the same satellite.
- No mutation actions in this chunk — connection lifecycle is
  observed only, not commanded.

Plumbing: `SatelliteWsHandler` and `HeartbeatMonitor` both take an
optional hook sink in their constructor. The sink is provided from
`afterPluginsReady` where `emitHook` is available; until then, the
classes behave exactly as before (no hooks fired, no behavioural
change).
