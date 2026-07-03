---
title: "Satellites"
description: "The satellite protocol: enrollment and token auth, the assignment dispatch and result contract, and the per-result authorization invariant that bounds what a satellite may report."
---

A satellite is a lightweight Checkstack agent that runs in a different network
or region and executes health checks on the core's behalf, shipping results
back over a persistent WebSocket connection. The operator-facing model lives in
the [Satellites concept page](/checkstack/user-guide/concepts/satellites/) and
the [Connect a satellite guide](/checkstack/user-guide/guides/connect-a-satellite/).
This page is the developer reference for the protocol, the package split, and
the security invariants that bound a satellite's authority.

## Package split

Four packages make up the satellite system, following the platform's
general-to-specific dependency direction:

| Package | Role |
|---------|------|
| `@checkstack/satellite-common` | Leaf package: the wire protocol (`SatelliteToCoreMessageSchema` / `CoreToSatelliteMessageSchema`), the assignment schema, the management RPC contract, route and signal definitions, and shared constants (heartbeat interval, offline threshold, reconnect backoff). |
| `@checkstack/satellite-backend` | Core-side: the management RPC router, the `SatelliteService` (persistence, token issuance/verification), the WebSocket handler, the config relay, the heartbeat monitor, and the reactive `satellite-connection` entity. |
| `@checkstack/satellite` | The agent runtime: the `SatelliteClient` (connect/auth/heartbeat/reconnect), the scheduler, result buffering, the strategy loader, and the sandbox-policy cache. Runs in the remote satellite process. |
| `@checkstack/satellite-frontend` | The admin UI: list, create, and token-rotation surfaces. |

The transport is a single WebSocket route. `satellite-backend` registers its
handler under the scoped WS registry with pluginId `satellite`, which is
auto-prefixed, so the endpoint is served at **`/api/ws/satellite`**. The client
derives this URL from its configured core URL, upgrading `http`/`https` to
`ws`/`wss`.

## Enrollment and token authentication

A satellite is enrolled through the management contract in
[`satellite-common/src/rpc-contract.ts`](https://github.com/enyineer/checkstack/blob/main/core/satellite-common/src/rpc-contract.ts),
gated on `satellite.manage`:

1. An admin calls `createSatellite`. The service generates a
   cryptographically-random token with a recognizable `csat_` prefix, stores
   **only its bcrypt hash**, and returns the plaintext token **once** (it is
   never stored and cannot be retrieved again).
2. The satellite's own UUID (its row `id`) doubles as the `clientId`. There is
   no separate credential record.
3. `rotateSatelliteToken` issues a fresh token and invalidates the previous one
   immediately; `updateSatellite` changes only metadata and leaves the token
   intact.

On the wire, the satellite must send an `authenticate` message
`{ type, clientId, token }` as its **first** message. The handler in
[`satellite-ws-handler.ts`](https://github.com/enyineer/checkstack/blob/main/core/satellite-backend/src/satellite-ws-handler.ts)
looks the satellite up by `clientId` (an O(1) lookup) and verifies the token
against the stored bcrypt hash:

- On success it replies with `authenticated` (see below) and the connection
  enters the post-authentication state.
- On failure (or any non-`authenticate` first message) it replies with
  `auth_failed` and closes the socket. The client does **not** reconnect on
  `auth_failed` - wrong credentials are terminal.

## The assignment dispatch contract

The `authenticated` reply carries the satellite's full configuration:

```ts
{
  type: "authenticated";
  satelliteId: string;
  assignments: SatelliteAssignment[];
  scriptPackagesLockfileHash?: string | null;
  sandboxPolicy?: SandboxPolicy;
}
```

Each `SatelliteAssignment` is everything the satellite needs to run one health
check: `configId`, `systemId`, `strategyId`, the strategy `config`, optional
`collectors`, and an `intervalSeconds`. The core re-pushes the full assignment
set on any change via a `config_updated` message, so the satellite always
converges on the authoritative set rather than applying deltas.

Two optional fields ride alongside assignments:

- **`scriptPackagesLockfileHash`** is the desired script-package state. It is
  carried on the `authenticated` reply (and `config_updated`) as the durable
  convergence backstop, so a satellite that missed a live
  `refresh_script_packages` push still reconciles on its next connect.
- **`sandboxPolicy`** is the resolved cluster-wide script-sandbox policy. The
  satellite **fails closed** (denies egress) until it has received a policy, so
  a missing or version-skewed policy can never loosen the sandbox.

Secrets are deliberately NOT part of the assignment payload. When a collector
declares a `secretEnv` mapping, the satellite sends a `request_run_secrets`
message just before the run; the core resolves **only that collector's declared
refs** (read from the persisted assignment - the satellite does not choose which
secrets) and replies with `run_secrets`. The env map is held in satellite memory
only for the run's lifetime and is never persisted on either side.

## The result contract

The satellite reports each run with a `result` message:

```ts
{
  type: "result";
  configId: string;
  systemId: string;
  status: HealthCheckStatus;
  latencyMs?: number;
  result?: HealthCheckRunResult;   // typed for parity with the local executor
  executedAt: string;
}
```

The core forwards accepted results to healthcheck-backend's
`ingestSatelliteResult`, tagged with the satellite's id and a human-readable
source label, so a satellite-collected result is recorded exactly like a
locally-executed one. If the connection drops, the client buffers results in a
bounded FIFO ring and flushes them on reconnect, so a brief network outage does
not lose data.

> [!IMPORTANT]
> **Assertions are evaluated at ingest, on the core.** A satellite never
> evaluates assertions; `ingestSatelliteResult` grades the reported result
> against the check's assertions before storing it, downgrading a
> satellite-reported `healthy` run to `unhealthy` on any assertion failure. This
> needs no wire change and works for every satellite version. Ephemeral result
> fields (for example raw HTTP bodies used only for assertions) are stripped
> after evaluation, so they are never persisted. Because a dropped connection
> buffers results, a flushed run is graded against the configuration that is
> current at ingest time, not at execution time. See
> [Assertion outcomes and analytics](/checkstack/developer-guide/backend/healthchecks/collectors/#assertion-outcomes-and-analytics).

> [!IMPORTANT]
> **A satellite may only report results for the `(configId, systemId)` pairs it
> is actually assigned.** The handshake proves WHICH satellite is connected;
> this check proves WHAT it may report for. On connect (and on every
> `config_updated` push) the handler builds a per-connection set of the
> satellite's assigned `(configId, systemId)` pairs. Each inbound `result` is
> checked against that set; an unassigned pair is logged and the single message
> is dropped - the socket is **not** closed, so a stale cache right after a
> reassignment self-corrects on the next push without tearing down legitimate
> results.
>
> Without this authorization, a compromised satellite could forge health data
> for any system: suppress a real outage, raise false alarms, or inject
> payloads into charts and aggregates. The per-connection set is pod-local
> transport bookkeeping (`declareNonReactiveState`); the authoritative
> assignment set lives in the durable healthcheck tables and is re-read on every
> push.

## Liveness and connection state

The satellite sends a `heartbeat` every 15 seconds; the core treats it as
offline after 45 seconds (three missed beats). The single durable source of
truth for liveness is the `lastHeartbeatAt` column on the `satellites` table:
the reactive `satellite-connection` entity's `status` and `lastSeenAt` are
**computed on read** from it, so the entity is globally consistent from any pod
and self-heals - a stale row reads `offline` once the heartbeat ages past the
threshold, even if the pod that owned the socket crashed without writing
offline. The pod-local live-socket registry exists only to route control
messages (config pushes, script-package refreshes, shutdowns) to a socket this
pod physically holds; it is transport infrastructure, never the queryable state.

## Control messages

Beyond assignments and results, the core can push:

- `config_updated` - the refreshed assignment set after any change.
- `refresh_script_packages` - reconcile to a new script-package lockfile hash
  (best-effort liveness; the assignment-carried hash is the durable backstop).
- `sandbox_policy` - the new global sandbox policy on change (push-on-change
  relay; the policy in `authenticated` is the durable backstop).
- `script_package_manifest` / `script_package_blob` - replies to the
  satellite's content-addressed package-sync requests, so the satellite pulls
  packages from the core over the authenticated channel rather than a separate
  HTTP surface.
- `shutdown` - sent on token revocation; the satellite disconnects cleanly.
