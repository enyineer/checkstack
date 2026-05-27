---
title: Satellites
description: Remote agents that execute health checks from other networks or regions, then ship results back to the core Checkstack instance.
---

A Satellite is a lightweight Checkstack agent that runs in a different network or region from your main Checkstack instance and executes health checks on its behalf. The probe runs near the target, the result flows back over a persistent WebSocket connection, and the core records it just like a locally-executed run. This page explains when to use satellites and how the pairing works.

## When you need a satellite

By default, all health checks run on the core Checkstack container. That works as long as:

- The targets you want to monitor are reachable from the core container's network.
- Geographic latency between core and target is not part of what you are measuring.

Satellites come in when one of those breaks:

- **Network isolation.** The target is in a private network the core cannot reach (a customer VPC, a separate Kubernetes cluster, a network-segmented PCI environment). Deploy a satellite inside that network. The satellite opens an outbound WebSocket to the core; you do not need to expose the target to the core or punch firewall holes inbound.
- **Geo-distribution.** You want to measure latency or availability from multiple regions. Deploy a satellite per region. Each satellite executes the check independently, and the UI shows you per-region results.
- **Probe locality.** Some checks (large SSH command outputs, heavy SQL queries) are cheaper to run close to the target. A satellite in the same region as the target keeps that cost off your main link.

> [!NOTE]
> A satellite is not a fallback or a high-availability mechanism. It is a way to extend reach. The core remains the single source of truth; satellites are stateless executors.

## The pairing model

A satellite identifies itself with two pieces of credential material:

- A **client ID** (the satellite's UUID, generated when an admin creates the satellite record in the UI).
- A **token** (a pre-shared API token, generated alongside the client ID and shown exactly once).

The pairing flow:

1. An admin clicks **Add satellite** in the Checkstack UI under **Infrastructure -> Satellites**. They give it a name and a region label.
2. Checkstack generates the client ID and a fresh token. The token is shown only once; copy it now or rotate later.
3. The admin deploys the satellite container with three environment variables:
   - `CHECKSTACK_CORE_URL`: the URL of the core Checkstack instance.
   - `CHECKSTACK_SATELLITE_CLIENT_ID`: the satellite's UUID from step 2.
   - `CHECKSTACK_SATELLITE_TOKEN`: the API token from step 2.
4. The satellite container starts, opens a WebSocket to the core, authenticates with its client ID and token, and starts heartbeating.
5. The core marks the satellite **online** and starts sending it check execution jobs.

> [!IMPORTANT]
> Tokens are stored as bcrypt hashes server-side. If a token is lost, you cannot recover it. Rotate the token from the satellite detail page; the rotation invalidates the old token and shows a fresh one.

## Assigning checks to satellites

By default a health check assignment runs locally on the core. To use satellites, edit the assignment on a system's detail page:

- **Satellite IDs.** Pick one or more satellites to run the check from.
- **Include local.** When satellites are selected, you can decide whether the core also continues running the check locally in parallel. Default is on.

Each result is tagged with its **source**: `null` for local execution, the satellite's UUID otherwise. The UI shows a human-readable source label (for example, "EU West (eu-west-1)") on each run row and aggregates per-source for charts.

> [!TIP]
> Running both local and satellite execution in parallel is the typical pattern when adding a satellite to an existing check. You see the local result you already trusted alongside the new per-region result; once the satellite is proven you can toggle local off.

## Heartbeats and online status

The satellite emits a heartbeat on its WebSocket connection. The core keeps a `last_heartbeat_at` per satellite. A satellite is considered **online** while its connection is open; if the connection drops or stops heartbeating, it goes **offline** and the core stops queuing jobs to it. Pending jobs surface as failed runs with a clear "satellite offline" message instead of silently never executing.

The satellites list in **Infrastructure -> Satellites** shows current online state, last heartbeat timestamp, satellite version, and tags.

## Tags

Satellites carry a free-form `tags` map (key/value strings). Use tags to organise satellites by environment, cloud provider, customer tenant, or anything else that matters in your setup. Tags are advisory metadata today; they do not yet drive automatic check assignment.

## Versioning and updates

Satellites report their version on connect. The core does not auto-update satellites; you upgrade them the same way you upgrade the core: pull a new image, restart the container. Keep your satellite version close to your core version; very stale satellites may not understand newer strategies.

> [!WARNING]
> Older satellites may lack support for strategies introduced after their build. If you install a new health check strategy plugin on the core and assign it to an old satellite, the satellite will reject the job. Upgrade the satellite or pick a newer one.

## Security model

- The satellite connection is outbound from the satellite to the core. You do not have to expose the satellite to the internet.
- The token authenticates the satellite to the core. There is no per-check authentication between core and satellite; trust is granted at the connection level.
- Config relayed to the satellite (credentials in the check config, for example) is sent over the authenticated connection. The satellite uses the relayed config only for the duration of the run and does not persist it.

> [!CAUTION]
> A satellite has the same secret material reach as the core for the checks assigned to it. Treat satellite hosts as carefully as you would the core: hardened image, restricted SSH, monitored.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Infrastructure -> Satellites** | List, create, delete, and rotate tokens for satellites. |
| **Satellite detail** | See online status, last heartbeat, version, and tags. Rotate the token. |
| **System detail -> Health check assignment** | Pick which satellites execute the check. Toggle `Include local`. |
| **Health check run row** | See the source label per result (Local, EU West, ...). |

## Where to go next

- **Hands-on.** Walk through [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/).
- **Per-region checks.** See [Health checks](/checkstack/user-guide/concepts/health-checks/) for how satellite-tagged runs feed into aggregates.
- **GitOps.** [GitOps](/checkstack/user-guide/concepts/gitops/) can declare satellite records and tags as YAML.
