---
title: "Connect a satellite"
description: "Mint a satellite token in the Checkstack UI, boot the satellite container, and confirm it shows up online so you can run checks from a remote vantage point."
---

A satellite is a small Checkstack agent you run somewhere the core server cannot reach directly: another region, another VPC, a customer site, an air-gapped network. Once a satellite is connected, you can pin specific health checks to run from it instead of from the core. For the full mental model, see [Satellites](/checkstack/user-guide/concepts/satellites/).

This walkthrough mints a registration token in the UI, boots the satellite container with that token, and verifies the satellite comes online.

## 1. Open the Satellites page

From the user menu, open **Satellites**. The page lists every satellite registered on this instance, with name, region, status (online or offline), and version.

If this is your first satellite, the list shows an empty state explaining what satellites are and a **Create satellite** button.

## 2. Create the satellite record

1. Click **Create satellite**.
2. Fill in the dialog:
   - **Name** - human-readable, for example `EU West Production`.
   - **Region** - a descriptive identifier for the geographic location, for example `eu-west-1`, `us-east-2`, or `datacenter-fra`. This is free text, not an AWS region.
3. Click **Create satellite**.

Checkstack creates the satellite record and shows the credentials in a follow-up dialog.

## 3. Capture the credentials

The credentials dialog shows a **Client ID** (a UUID) and a **Token** (the bcrypt-hashed pairing token). Both are required by the satellite at startup.

> [!WARNING]
> Copy the token now. Checkstack only stores the hashed form; the plaintext value cannot be retrieved later. If you lose it, click the **Reset token** key icon next to the satellite in the list to mint a new one (this invalidates the old token).

The dialog also prints the three environment variables the satellite container needs:

```env
CHECKSTACK_CORE_URL=<your-core-url>
CHECKSTACK_SATELLITE_CLIENT_ID=<the-client-id>
CHECKSTACK_SATELLITE_TOKEN=<the-token>
```

`CHECKSTACK_CORE_URL` is the public URL of your Checkstack core server (the same one you visit in the browser). The satellite opens a WebSocket against it.

## 4. Pull the satellite image

The satellite ships as a lean Docker image, built from `Dockerfile.satellite` in the repository. It bundles only `healthcheck-*` and `collector-*` plugins, not the full platform.

```bash
docker pull ghcr.io/enyineer/checkstack-satellite:latest
```

> [!TIP]
> Pin the image tag to the same release as your core server in production. Running mismatched versions works in the short term but is not a supported configuration.

## 5. Extract the sandbox seccomp profile

A satellite executes script-based health checks inside the same fail-closed
sandbox as the core, so its container needs two runtime relaxations (see step 6).
One of them is a tuned seccomp profile that the Docker daemon reads from a file
on the satellite host. The profile ships inside the satellite image, so extract
it once next to where you will run the container. This works offline and in
air-gapped networks - it never touches GitHub or the core:

```bash
docker run --rm ghcr.io/enyineer/checkstack-satellite:latest \
  print-seccomp > checkstack-userns.json
```

> [!IMPORTANT]
> If you skip the sandbox flags below, the satellite still starts and connects,
> but it will refuse to run every script-based health check (the sandbox is
> fail-closed by default). You will see those checks error instead of execute.

## 6. Boot the satellite container

Start the container with the three environment variables from step 3 plus the
two `--security-opt` flags that enable the script sandbox:

```bash
docker run -d \
  --name checkstack-satellite \
  --restart unless-stopped \
  --security-opt seccomp=checkstack-userns.json \
  --security-opt systempaths=unconfined \
  -e CHECKSTACK_CORE_URL=https://checkstack.example.com \
  -e CHECKSTACK_SATELLITE_CLIENT_ID=<client-id> \
  -e CHECKSTACK_SATELLITE_TOKEN=<token> \
  ghcr.io/enyineer/checkstack-satellite:latest
```

> [!TIP]
> If your platform cannot mount the profile file, replace the first flag with
> `--security-opt seccomp=unconfined` (still non-root and namespace-confined,
> just a looser syscall filter). See
> [Script sandbox](/checkstack/developer-guide/security/script-sandbox/) for the
> full security model and the Kubernetes equivalent.

The container fails fast if any of the three variables is missing. Tail the logs to confirm it connected:

```bash
docker logs -f checkstack-satellite
```

You should see lines like:

```text
[satellite] Starting Checkstack Satellite v...
[satellite] Loading health check strategies...
[satellite] Core URL: https://checkstack.example.com
[satellite] Client ID: <client-id>
[satellite] Connected to core
```

If you see `WebSocket close` or authentication errors instead, double-check the URL, client ID, and token. The token must match the one the dialog showed in step 3 exactly.

## 7. Confirm the satellite is online

Back in Checkstack, refresh the **Satellites** page. The new satellite should now show:

- **Status** - `online` (green badge).
- **Version** - the satellite container version it reported at handshake.

The status updates in real time via WebSocket signals. If the satellite drops the connection, the badge flips to `offline` within a few seconds.

## 8. Assign a health check to the satellite

The point of the satellite is to run checks from its vantage point. Execution is a per-**assignment** property (a check on a specific system), NOT a property of the check template you edit under the **Health Checks** sidebar. So you pin execution from the system the check is assigned to:

1. Open **Catalog** and open the system whose check you want to run from the satellite.
2. On that system, click **Health Checks** to open its assignment editor.
3. In the sidebar, select the assigned check, then open its **Execution** node.
4. Under **Execution Sources**, enable your new satellite in the **Assigned Satellites** list. Leave **Execute this health check on the core server** on to run from both, or turn it off to run only from the satellite (you must keep at least one source enabled).
5. Click **Save**.

Only network strategies can run remotely (HTTP, TCP, ping, DNS, and similar). A check that must run on the core server does not offer a satellite.

The next run executes on the satellite. The result returns through the WebSocket and lands in the check history alongside core-executed runs. The history detail page shows which satellite produced each run.

## 9. Manage the satellite over time

- **Reset token** - the key icon next to the satellite in the list mints a new token and invalidates the old one. Update the running container's env var and restart.
- **Delete** - the trash icon removes the satellite. Any assignments pointing at it fall back to core execution.
- **GitOps managed** - if you manage satellites declaratively, see the `kind: Satellite` schema in [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/). The bcrypt token is never expressed in YAML; you still use the **Reset token** button to mint one.

## See also

- [Satellites](/checkstack/user-guide/concepts/satellites/) - the mental model.
- [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/) - declaring satellites in YAML.
- [Set up your first health check](/checkstack/user-guide/guides/first-health-check/) - the prerequisite for pinning a check to a satellite.
