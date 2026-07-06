---
title: "Monitor containers"
description: "Monitor a Docker or Podman container's state, health, and resource usage from Checkstack without ever exposing the raw container socket, by running a read-only socket-proxy next to your core instance or a satellite."
---

The **Container** health check watches a single Docker or Podman container: whether it exists, whether it is running, its healthcheck status, exit code, restart count, and CPU/memory usage. It is built for containers that expose no external service of their own, so there is nothing for an HTTP or TCP probe to hit.

The check runs wherever the executor runs: **locally on your core instance** (the default), or on a **satellite** you pin it to. Use core-local execution to watch containers that share a host with Checkstack; use a satellite to watch containers on another host, region, or network. For the satellite model see [Satellites](/checkstack/user-guide/concepts/satellites/).

Checkstack never talks to the raw container socket. The container socket (`/var/run/docker.sock`) is root-equivalent: anything that can write to it can take over the host. Instead you run a small **read-only socket-proxy** next to the Checkstack instance that will run the check, and the check reaches the proxy over a private network. Even a fully compromised instance can then only *read* container state, never control the host.

## What you can assert on

The check ships two collectors, both of which only issue read (GET) requests so they work against a read-only proxy:

- **Container Status** - `exists`, `running`, `state` (`running`, `exited`, ...), `health` (`healthy`, `unhealthy`, `starting`, `none`), `exitCode`, `restartCount`, `oomKilled`.
- **Container Stats** - `cpuPercent`, `memoryPercent`, `memoryUsageBytes`, `memoryLimitBytes`.

A stopped or missing container is a **successful** collection, not a transport failure: the metrics are recorded and your assertions decide the health state (for example, assert `running isTrue`). Only an unreachable runtime endpoint fails the check outright.

## 1. Run the socket-proxy next to Checkstack

The proxy is defined once, in a canonical compose file Checkstack maintains:
[`deploy/socket-proxy/docker-compose.yml`](https://github.com/enyineer/checkstack/blob/main/deploy/socket-proxy/docker-compose.yml). It mounts the socket **only** into the proxy (read-only), makes the proxy read-only (`POST=0`), and puts it on an `internal` network so its port is never reachable from the host or the internet. Rather than copy that block into every deployment, you `include:` the file and just add its network to your Checkstack service.

Download the file next to your existing compose:

```bash
curl -o socket-proxy.yml \
  https://raw.githubusercontent.com/enyineer/checkstack/main/deploy/socket-proxy/docker-compose.yml
```

### Core (containers on the core host)

Add two things to your standard core `docker-compose.yml`: the `include:` line, and the `checkstack-internal` network on the `checkstack` service. Everything else stays as-is:

```yaml
name: checkstack

include:
  - socket-proxy.yml # the canonical proxy + checkstack-internal network

services:
  checkstack:
    # ...all your existing config (image, env_file, ports, security_opt, ...)...
    networks:
      - default             # your existing network: postgres, outbound, port 3000
      - checkstack-internal # reach http://socket-proxy:2375
```

Checkstack now reaches the proxy at `http://socket-proxy:2375` (the check's default endpoint).

### Satellite (containers on another host)

Identical pattern on your standard `docker-compose-satellite.yml` - `include:` the file and add the network to the `satellite` service, which keeps `default` for its outbound WebSocket to core:

```yaml
name: checkstack-satellite

include:
  - socket-proxy.yml

services:
  satellite:
    # ...all your existing config (image, env_file, security_opt, ...)...
    networks:
      - default             # outbound WebSocket to core
      - checkstack-internal # reach the read-only proxy
```

The `CHECKSTACK_SATELLITE_CLIENT_ID` / `CHECKSTACK_SATELLITE_TOKEN` come from **Satellites -> Create** in the core UI; see [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/).

> [!NOTE]
> `include:` requires Docker Compose v2.20 or newer. On older Compose, copy the `socket-proxy` service and the `checkstack-internal` network out of the canonical file into your compose directly.

> [!CAUTION]
> Keep the proxy read-only (`POST=0`). Container `exec` style probes are intentionally not offered, because they would require write access to the socket - which is exactly the exposure this setup avoids.

## 2. Podman

Podman is daemonless and its rootless socket carries no host-root authority, so it is already low-risk. Enable the rootless socket for your user:

```bash
systemctl --user enable --now podman.sock
```

Then either point the check straight at that socket (`unix:///run/user/<uid>/podman/podman.sock`) or front it with the same `socket-proxy` image, which speaks the Podman libpod API.

## 3. Create the check

1. Go to **Health Checks -> Configurations** and create a check with the **Container** strategy. The editor shows a **Setup guide** callout that repeats the essentials above.
2. Set:
   - **Endpoint** - `http://socket-proxy:2375` (the default), or your Podman socket path.
   - **Container** - the container name or ID to watch.
3. Add the **Container Status** and/or **Container Stats** collectors and any assertions (for example `running isTrue`, or `cpuPercent lessThan 90`).
4. Choose where it runs: leave **Run locally** on to execute on core, and/or assign it to a satellite on the target host.

> [!IMPORTANT]
> If your core runs as several pods across different hosts, a core-local container check runs on whichever pod picks up the job. Point the endpoint at a proxy that resolves to one specific host, or assign the check to a satellite, so it always inspects the host you mean.

## Security summary

- The raw socket is mounted **only** into the proxy, read-only. Checkstack (core and satellites) only ever reaches the proxy.
- The proxy is read-only (`POST=0`) and whitelists just the container/info endpoints, so a compromise yields read-only inspection, never host control.
- The proxy port lives on an `internal` network, unreachable from the host or the internet.
- For Podman, prefer the rootless socket - it has no host-root authority to begin with.

## Where to go next

- **Satellites.** [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/) to watch containers on another host or network.
- **Assertions.** [Health checks](/checkstack/user-guide/concepts/health-checks/) covers assertions, thresholds, and how a completed-but-abnormal result differs from a transport failure.
