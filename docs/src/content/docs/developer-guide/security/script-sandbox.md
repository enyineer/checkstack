---
title: "Script sandbox"
description: "The layered OS-level sandbox around the shared script runners: per-layer configuration, capability detection, graceful degradation, and the cross-platform enforcement matrix."
---

Script and shell health checks, and the `run_shell` / `run_script`
automation actions, all execute through two shared runners in
`@checkstack/backend-api`. Those runners wrap every user-authored script in a
layered, secure-by-default OS-level sandbox: resource caps, filesystem
confinement, network egress control, and privilege dropping. Each layer is
capability-detected per host and degrades to a portable subset (never
hard-breaks) when a host lacks the primitive. This page is the reference for the
model, the policy schema, and what each layer maps to on a given host.

## Global-only policy

The sandbox policy is GLOBAL, not per item. There is no per-check or per-action
`sandbox` override: an automation author cannot weaken or disable the sandbox on
their own action. The policy is configured once, cluster-wide, in a single
durable setting (shared database, read identically on every pod). An operator
opts the whole cluster out by storing `{ enabled: false }`, or loosens a single
layer (e.g. adding network allowlist entries) by storing a partial override
there.

The runners resolve the active policy themselves at run time through a
process-wide provider registered at startup. They never accept a policy argument
from a caller.

### Single source of truth

The global policy lives in ONE durable row owned by the `script-packages`
plugin (its `ConfigService` row in the shared `plugin_configs` table). That
plugin registers the single process-wide policy provider that every script
runner on a core pod resolves through, so the two script plugins
(`integration-script-backend`, `healthcheck-script-backend`) read the identical
value. Earlier each script plugin registered its own provider reading a
different plugin-scoped row, making the process-global provider last-writer-wins;
that is fixed - there is now exactly one writer and one provider.

### Admin settings UI

An administrator edits the global policy at **Settings -> Script Sandbox**
(`/script-packages/sandbox`). The page exposes every layer: `enabled`,
`onUnavailable` (degrade / fail), network mode (deny / allowlist / unrestricted)
with the allow list and the link-local/metadata block, filesystem mode,
privilege mode, and the resource caps.

Both the read and the write are gated by a DEDICATED admin permission,
`script-sandbox.manage` (a distinct `script-sandbox` resource, registered with
the `script-packages` plugin's access rules) - separate from
`script-packages.manage` and from `automationAccess.manage`. The policy reveals
the cluster's exact egress / filesystem / privilege posture, so viewing it is
admin-only too. The endpoints are oRPC procedures on the script-packages
contract:

```ts
import { ScriptPackagesApi } from "@checkstack/script-packages-common";

// READ (requires script-sandbox.manage)
const policy = await client.forPlugin(ScriptPackagesApi).getSandboxPolicy();

// WRITE (requires script-sandbox.manage); input is a partial merged over the
// safe default, returns the fully-resolved stored policy.
await client.forPlugin(ScriptPackagesApi).setSandboxPolicy({
  network: { mode: "allowlist", allow: ["203.0.113.0/24"], denyLinkLocalAndMetadata: true },
});
```

> [!IMPORTANT]
> Removing the per-action override is a security fix. Previously an action
> author with `automationAccess.manage` could ship `sandbox: { enabled: false }`
> on their own action and run effectively unsandboxed. Policy is now
> global-only and cannot be weakened per item.

## Fail closed

If no policy provider is registered, or the registered provider throws (for
example a transient database error reading the durable default), the runner does
NOT fall back to a permissive profile. It falls back to the most restrictive
safe policy: egress denied, filesystem confined to the per-run scratch dir plus
a read-only managed-package tree, and a privilege drop. The fallback is surfaced
as a downgrade in the run's `EffectiveSandbox` report so it is never silent. A
misconfigured or un-wired runtime denies; it does not run unsandboxed.

## Policy schema

The policy is a single zod schema. Every layer is optional and defaulted, so a
partial global override only touches the fields it sets:

```ts
import { sandboxPolicySchema, type SandboxPolicyInput } from "@checkstack/backend-api";

const policy: SandboxPolicyInput = {
  enabled: true,
  onUnavailable: "degrade", // or "fail" to refuse when a layer is unenforceable
  resources: {
    cpuSeconds: 60,
    memoryBytes: 512 * 1024 * 1024,
    maxOpenFiles: 1024,
    maxProcesses: 256, // per-run fork-bomb cap; applied inside the wrapper user namespace
    maxOutputBytes: 5 * 1024 * 1024,
    maxFileSizeBytes: 256 * 1024 * 1024,
  },
  filesystem: { mode: "scratch-plus-ro" }, // off | scratch-only | scratch-plus-ro
  network: {
    mode: "allowlist", // unrestricted | deny | allowlist
    allow: [], // empty = deny egress until entries are added
    denyLinkLocalAndMetadata: true,
  },
  // Under the shipped non-root supervisor, drop-to-uid is satisfied by
  // inheritance (the child cannot be host-root); the uid/gid are only used on a
  // legacy root supervisor's wrapper `--uid` drop.
  privilege: { mode: "drop-to-uid" }, // or "inherit"
};

const parsed = sandboxPolicySchema.parse(policy);
```

## The shipped default profile

With no configuration an install gets this profile (the dedicated UID/GID are
seeded from `CHECKSTACK_SANDBOX_UID` / `CHECKSTACK_SANDBOX_GID` at run time):

```ts
{
  enabled: true,
  onUnavailable: "fail",
  resources: {
    cpuSeconds: 60,
    memoryBytes: 512 * 1024 * 1024,
    maxOpenFiles: 1024,
    maxProcesses: 256,
    maxOutputBytes: 5 * 1024 * 1024,
    maxFileSizeBytes: 256 * 1024 * 1024,
  },
  filesystem: { mode: "scratch-plus-ro" },
  // Secure-by-default: allowlist with an EMPTY allow list = deny egress until
  // an operator adds entries.
  network: { mode: "allowlist", allow: [], denyLinkLocalAndMetadata: true },
  privilege: { mode: "drop-to-uid" },
}
```

What this profile does:

- `onUnavailable: "fail"` is FAIL-CLOSED. If any requested layer cannot be
  enforced on the host, the run is REFUSED (clean `exitCode: -1`, no unsandboxed
  spawn) rather than silently dropping to a weaker subset. A malicious script
  never slips through on a host that is missing a sandbox primitive. The
  official container images are built to support every layer, so this default
  WORKS out of the box there (see the container section below). An operator on a
  host that genuinely cannot enforce a layer can switch the global policy to
  `degrade` in the admin settings - an explicit, audited opt-out, never a silent
  one.
- Network is an `allowlist` with an EMPTY allow list, so egress is DENIED by
  default. An empty allow list is semantically identical to `deny`, so it is
  delivered by the routeless network-namespace path (loopback only, no
  egress plumbing or nftables ruleset required) and therefore enforces on ANY
  netns-capable host. Ordinary outbound `fetch` does NOT work until an operator
  allowlists the destinations a script may reach (globally, in the durable
  default); a non-empty allow list then needs the plumbed+filtered path (macvlan
  or rootless slirp4netns). The always-on metadata/link-local block additionally
  closes SSRF-to-metadata exfil (a routeless namespace blocks it inherently).
- `filesystem: scratch-plus-ro` makes temp-file writes land in the per-run
  scratch dir and keeps managed-package imports resolving via a read-only
  `node_modules` bind. Reads of arbitrary host paths break (on a wrapper host).
- The resource caps are headroom, not work limits. `memoryBytes` is enforced via
  the ESM JS-heap cap and the container cgroup limit, NOT `prlimit --as` (see
  Resource limits below). For shell scripts there is NO per-run memory cap; the
  cgroup is the ceiling and the gap is surfaced as a non-fatal note.
- `privilege: drop-to-uid` is satisfied by the NON-ROOT supervisor: the shipped
  images run the supervisor as uid 65532, so every script inherits non-root by
  construction and can never be host-root, regardless of any wrapper. See
  Privilege dropping.

## The four layers

### Resource limits

CPU time, open files, and single-file write size are enforced via a `prlimit`
argv prelude on Linux when `prlimit` is on `PATH`. `maxOutputBytes` is enforced
purely in the runner by counting bytes off the captured streams and killing the
child on overflow, so it works on every platform. When `prlimit` is unavailable
the rlimit caps drop and the runner falls back to the wall-clock timeout and
output truncation.

`maxProcesses` (RLIMIT_NPROC) is the per-run fork-bomb cap. RLIMIT_NPROC is
enforced per (UID, user-namespace): the kernel counts a process against its real
UID within its user namespace. The shipped default confines every run with
rootless `bwrap --unshare-all`, which creates a FRESH user namespace (and a
fresh PID namespace) per run, so the `--nproc` cap genuinely isolates THIS run's
process count even though the child shares the supervisor's uid (65532). The
fork bomb hits the cap and fails; the supervisor and any sibling runs (in their
own namespaces) keep forking. The fresh PID namespace means a single kill of the
wrapper reaps the whole fork tree, and the script cannot see or signal host PIDs.

This is verified in-container: an aggressive fork bomb through both runners
(shell `:(){ :|:& };:` and an ESM spawn loop) is capped and the supervisor stays
alive and responsive, with every other layer still enforced and zero downgrades.

The cap is applied whenever a namespace wrapper is engaged (the shipped default
engages it via the `scratch-plus-ro` filesystem layer) or the child dropped to a
dedicated low-priv uid via a root-supervisor wrapper `--uid`. It is omitted ONLY
on an unwrapped run (filesystem `off` AND host network), where there is no user
namespace to isolate the count and a per-UID cap would also throttle the
supervisor; that corner case surfaces a non-fatal note (never a downgrade, so
the fail-closed default still runs) and the container cgroup `pids` controller
(Docker `--pids-limit` / a Kubernetes limit) remains a backstop.

> [!TIP]
> A cgroup `pids` limit is still recommended as a cluster-wide backstop, but it
> is no longer the only fork-bomb defense: the per-run RLIMIT_NPROC cap is
> enforced inside the bwrap user namespace on the shipped default path.

> [!IMPORTANT]
> `memoryBytes` is NOT mapped to `prlimit --as` (RLIMIT_ADDRESS_SPACE).
> RLIMIT_AS caps the VIRTUAL address space, not the resident set, and modern
> runtimes (Bun, Node, the JVM) reserve tens of GiB of virtual space at startup,
> so an `--as` equal to the intended RSS makes the interpreter abort immediately.
> Memory is instead enforced by (1) the ESM JS-heap cap
> `NODE_OPTIONS=--max-old-space-size` (a real heap limit the runtime honours) and
> (2) the container CGROUP limit (Docker `--memory` / a Kubernetes
> `resources.limits.memory`), which the deployment supplies.

> [!WARNING]
> Shell scripts have NO per-run memory enforcement. The
> `NODE_OPTIONS=--max-old-space-size` heap cap is honoured only by the ESM/Node
> interpreter; `sh -c` ignores it. So the `memoryBytes` policy value is NOT a
> per-run guarantee for shell scripts - their only memory ceiling is the
> container cgroup limit. The runner does NOT pretend otherwise: it surfaces a
> non-fatal NOTE on the run's `EffectiveSandbox` report
> (`notes: [{ layer: "resources", note: "..." }]`) rather than a downgrade, so
> it neither misleads operators nor fail-closes (refusing every shell run would
> break all shell health-checks and automation). Supply a cgroup memory limit in
> your deployment to bound shell memory.

### Filesystem isolation

`scratch-only` confines the child to its per-run scratch directory (writable)
over a read-only minimal base system. `scratch-plus-ro` additionally read-only
binds the managed `node_modules` tree so package imports resolve. Delivered by a
namespace wrapper (`bwrap`, then `nsjail`); the language interpreter is bound in
automatically and `$TMPDIR` is pinned to the in-namespace `/tmp`. Without a
wrapper the layer degrades to `off` and is reported.

### Network egress control

Egress is filtered at the kernel (a network namespace), so it covers `fetch`,
raw sockets, and DNS uniformly.

- `deny` drops the child into a fresh, routeless network namespace with loopback
  only. Any wrapper delivers it.
- `allowlist` permits only the listed IPv4/IPv6 CIDRs (v1 is IP/CIDR only;
  resolve domains yourself or front them with an egress proxy). A fresh
  namespace is routeless, so `allowlist` additionally plumbs real egress in and
  then filters it with nftables. Egress is plumbed by one of two paths,
  preferred in order:
  1. **Privileged macvlan** (`nsjail` running as root): a macvlan uplink off a
     usable host interface, addressed with `--macvlan_vs_ip/_nm/_gw`.
  2. **Rootless slirp4netns** (`bwrap` + unprivileged user namespaces +
     `slirp4netns`): a userspace TCP/IP stack with deterministic built-in
     addressing (`10.0.2.0/24`, gateway `10.0.2.2`), NAT'd out through the
     parent namespace. Needs no root, no host uplink, and no operator
     addressing - the common rootless-container case (rootless Podman/Docker).
- `denyLinkLocalAndMetadata` (default on) always drops `169.254.0.0/16`,
  `fe80::/10`, and `fc00::/7`, so a script cannot reach `169.254.169.254`.

On the **macvlan** path the interface comes up unaddressed and has no route, so
`allowlist` and the always-on metadata block only engage when egress can be
plumbed AND addressed: `nsjail` running as root, a usable host interface, plus
the static address triple from `CHECKSTACK_SANDBOX_MACVLAN_IP`,
`CHECKSTACK_SANDBOX_MACVLAN_NM`, and `CHECKSTACK_SANDBOX_MACVLAN_GW`. Deriving a
free address and the default gateway from the host automatically is a
collision/TOCTOU footgun, so it is supplied explicitly.

On the **rootless** path there is nothing to configure: `slirp4netns` supplies
the addressing deterministically. The platform generates a small launcher that
brings up the userspace stack and loads the nftables filter **fail-closed** -
the default-drop egress ruleset is installed inside the namespace BEFORE the
`tap0` device comes up, and the real command only runs once both are ready. So
there is no window in which traffic flows past an un-loaded filter; if
`slirp4netns` or `nft` fails, the run fails closed (no unfiltered egress).

When NEITHER path is available (no root + no `slirp4netns`/userns, or no
wrapper, or non-Linux), engaging a routeless namespace would blackhole all
traffic, so the platform keeps the host network and reports the gap per run.
This is the remaining v1 allowlist-reachability limitation: `allowlist` and the
metadata block are enforced on privileged-macvlan OR rootless-slirp4netns hosts,
and degrade-and-surface where neither is available (user namespaces disabled,
macOS, no wrapper) - never a silent blackhole, never a silent allow-all.

### Privilege dropping

The shipped images run the SUPERVISOR as a non-root uid (65532). The script
INHERITS that uid by construction, so it can NEVER be host-root - the
`drop-to-uid` requirement is satisfied by inheritance, regardless of whether a
wrapper is engaged. Under rootless `bwrap` (`--unshare-user`), in-namespace root
maps back to the same unprivileged host uid, so even mapped-root cannot escape
to host root. `enforced.privilege` is true whenever the process cannot be
host-root.

> [!IMPORTANT]
> The runner NEVER passes `uid`/`gid` to `Bun.spawn`. On the shipped Bun
> versions it is a silent no-op (the privilege drop is delivered by inheritance
> from the non-root supervisor, or by the wrapper's `--uid` on a root
> supervisor), AND passing it is a forward-compat hazard: a future Bun that
> honoured it would spawn the namespace WRAPPER itself as the dropped id and
> break unprivileged-userns creation. The `EffectiveSandbox` report's `uid`
> field is observability-only.

> [!NOTE]
> Legacy ROOT supervisor (some deployments): when the supervisor euid IS root,
> the child would inherit root, so the drop MUST be performed by the namespace
> wrapper (`bwrap --uid`/`--gid`, `nsjail --user`/`--group`) to a dedicated
> low-priv id. That only engages when filesystem confinement or a network
> namespace engages the wrapper. A `drop-to-uid` (or `inherit`) under a root
> supervisor with NO wrapper engaged leaves the child as host-root: it is
> reported NOT enforced with a surfaced downgrade, never a false positive. The
> shipped images avoid this entirely by running the supervisor non-root. A
> rootless `--uid` to a DIFFERENT id is impossible without subuid/newuidmap and
> is not needed under the non-root model.

## Capability detection and degradation

Capabilities are detected once per process (no per-run probe) and may
legitimately differ between a Linux pod and a macOS satellite. Each unavailable
layer follows the policy's `onUnavailable`: `degrade` (the default) falls back
to the portable subset and records a downgrade; `fail` refuses to run the script
before any child is spawned.

### Live user-namespace probe

Whether a user + network namespace can be created is decided by a LIVE probe,
not a static sysctl toggle. At detection time the platform actually attempts
`clone(CLONE_NEWUSER | CLONE_NEWNET)` (via an `unshare --user --net` child) and
caches the result for the process lifetime. This closes a truthfulness gap: on
the default Docker/containerd seccomp profile the `unprivileged_userns_clone`
sysctl file is absent (so a toggle-only check would read "available") while the
live clone is actually BLOCKED by seccomp, so bwrap would fail at spawn. Driving
`userNamespaces` / `netNamespaces` / `netEgressRootless` off the live probe means
the sandbox never claims `enforced.network = true` (or `filesystem`) on a host
where the namespace cannot be made. On a locked-down host the probe returns
false, the network/filesystem layers report a downgrade, and under the
fail-closed default the run is correctly REFUSED rather than silently reported as
enforced while the wrapper fails. With the shipped relaxations in place the probe
returns true and the layers enforce. The static sysctl is still consulted as a
cheap pre-gate (an explicit `0` short-circuits to false without a spawn).

Every degradation is surfaced: each run carries an
`EffectiveSandbox` report (`enforced` flags, a `downgrades` list, and a
non-fatal `notes` list), the call sites log a structured warning when a run
degrades, and each pod logs a one-time startup line with the detected primitives
and the effective enforcement of the configured global default. Degradation
never hides.

`notes` is distinct from `downgrades`: a note records an accepted, expected
enforcement characteristic (e.g. shell per-run memory bounded only by the
cgroup, or `maxProcesses` not applied on an unwrapped run with filesystem `off`
and host network) that an operator should know about but that is NOT a failure
to enforce the policy. A
note NEVER trips `onUnavailable: "fail"` and is logged at INFO, not WARN, so a
legitimate ceiling does not refuse the run or masquerade as a degradation.

## Cross-platform enforcement matrix

| Layer | Linux privileged (`nsjail` root + uplink) | Linux rootless (`bwrap` + userns + `slirp4netns`) | Linux, no wrapper / userns | macOS / restricted container |
| --- | --- | --- | --- | --- |
| Resource caps | full (rlimit via `prlimit`; per-run `--nproc` fork-bomb cap inside the wrapper userns) | full (rlimit via `prlimit`; per-run `--nproc` fork-bomb cap inside the bwrap userns) | rlimit via `prlimit` if present, else portable subset; `--nproc` only when a wrapper engages | portable subset (timeout, ESM memory flag, output truncation) |
| Filesystem | full (`scratch-only` / `-plus-ro`) | full (`scratch-only` / `-plus-ro`) | degrade to `off` (or `fail`) | degrade to `off` (or `fail`) |
| Network | full: `deny`; `allowlist` + metadata block via macvlan uplink (addressed) | full: `deny`; `allowlist` + metadata block via slirp4netns (fail-closed nft) | `deny` if a netns wrapper is present, else host net; `allowlist`/metadata block degrade to host net (or `fail`) | degrade to host net (or `fail`) |
| Privilege | non-root supervisor: inherited (or wrapper `--uid` on a root supervisor) | non-root supervisor: inherited (the shipped model) | inherited from a non-root supervisor; root supervisor + no wrapper = NOT enforced (surfaced) | inherited from a non-root supervisor (the dev/macOS case) |

The `allowlist` egress filter and the always-on metadata/link-local block are
genuinely enforced on BOTH the privileged-macvlan and the rootless-slirp4netns
columns. They degrade-and-surface (host net, reported per run) only where
neither path exists: user namespaces disabled, no wrapper, or a non-Linux host.

## Installing the wrapper for full isolation

The filesystem and network namespace layers need a wrapper. Install
[`bubblewrap`](https://github.com/containers/bubblewrap) (`bwrap`) for
filesystem confinement and `deny`. For `allowlist` egress filtering and the
always-on metadata block there are two routes:

- **Rootless (recommended for unprivileged hosts):** install `bwrap` plus
  [`slirp4netns`](https://github.com/rootless-containers/slirp4netns) and the
  `nft` (nftables) CLI, and ensure unprivileged user namespaces are enabled
  (`sysctl kernel.unprivileged_userns_clone=1` / `user.max_user_namespaces > 0`).
  No root and no host network configuration is required.
- **Privileged:** install [`nsjail`](https://github.com/google/nsjail), run the
  platform as root (CAP_NET_ADMIN), and set the macvlan address triple
  (`CHECKSTACK_SANDBOX_MACVLAN_IP` / `_NM` / `_GW`).

With no wrapper the platform still enforces the portable subset (resource
truncation, the env denylist, and the privilege drop where available).

## Local development

The OS-level layers are built on Linux kernel primitives, so on a macOS or
Windows dev machine (and on a Linux host without the primitives or with
unprivileged user namespaces disabled) none of them can be enforced. Under the
secure fail-closed default (`onUnavailable: "fail"`) the runners then REFUSE
every script run rather than execute it unsandboxed, and you will see:

```text
sandbox unavailable: resources: rlimit caps not enforceable ...; network: ... requires Linux net namespaces (platform=darwin); filesystem: ... requires Linux namespaces (platform=darwin); running with full host FS/net
```

That is the sandbox working as designed. On startup the backend also logs a
one-time warning describing the situation and the options below. You have two
supported ways to develop:

### Option 1: Docker, with production parity (recommended)

Run the runtime inside the Linux sandbox container. On macOS / Windows this uses
Docker Desktop's Linux VM, so the sandbox enforces exactly as it does in
production. The shipped [`docker-compose.yml`](https://github.com/enyineer/checkstack/blob/main/docker-compose.yml)
already sets the two required runtime relaxations (the bundled seccomp profile +
`systempaths=unconfined` for the `/proc` unmask):

```bash
docker compose up
```

To iterate on locally-built code with parity, build the image and run it with
the same `security_opt` block from the compose file. For Kubernetes, use the
example in [`deploy/k8s/checkstack-sandbox.yaml`](https://github.com/enyineer/checkstack/blob/main/deploy/k8s/checkstack-sandbox.yaml)
(Localhost seccomp profile + `procMount: Unmasked` + non-root).

### Option 2: Native dev with the degrade policy (fast iteration)

For a fast native `bun dev` loop on macOS / Windows, set the global Script
Sandbox policy to `degrade` in **Admin -> Settings -> Script Sandbox** (or via
the `setSandboxPolicy` RPC). Scripts then run with the portable subset
(wall-clock timeout + output truncation, NO OS isolation). This is fine for your
own development scripts but is NOT a security boundary, so leave the production
policy on `fail`. The policy is a single durable cluster-wide value, so do not
ship a dev instance's `degrade` policy to production.

### Linux dev machines

Native `bun dev` enforces fully once you install the primitives
(`bubblewrap util-linux nftables slirp4netns`) and enable unprivileged user
namespaces (see [Installing the wrapper](#installing-the-wrapper-for-full-isolation)).
No Docker required.

> [!IMPORTANT]
> Production MUST run on Linux with the bundled seccomp profile and the `/proc`
> unmask. The `degrade` policy is a development convenience, never a production
> posture.

## Container images

The official `Dockerfile` (core) and `Dockerfile.satellite` are built so the
secure FAIL-CLOSED default works out of the box. Each runtime image:

- installs every sandbox primitive: `bubblewrap` (the rootless `bwrap`
  launcher), `slirp4netns` (rootless egress), `util-linux` (`prlimit` +
  `unshare`), and `nftables` (the `nft` egress filter for non-empty allow lists);
- run the SUPERVISOR itself as a dedicated non-root identity `checkstack`
  (uid/gid `65532`) via `USER 65532:65532`. Every sandboxed script then inherits
  non-root by construction (`id -u` == 65532 inside a run) and can never be
  host-root. Confinement (filesystem + network) is delivered by ROOTLESS `bwrap`
  through unprivileged user namespaces. `CHECKSTACK_SANDBOX_UID` /
  `CHECKSTACK_SANDBOX_GID` are NOT set: a root-mapped `--uid` drop to a different
  id is neither possible rootless nor needed.

#### Required runtime relaxations (both)

The container RUNTIME must permit unprivileged user namespaces AND let the
sandbox remount `/proc` inside the nested namespace. The default Docker/k8s
seccomp profile gates the `clone(CLONE_NEWUSER)`/`unshare`/`mount`/`pivot_root`
syscalls behind CAP_SYS_ADMIN (which a non-root supervisor does not hold), and
masks paths under `/proc`. Under the unmodified runtime rootless `bwrap` fails
at spawn (`bwrap: Can't mount proc on /newroot/proc`) and the fail-closed
default would refuse. You need BOTH a seccomp relaxation AND a `/proc` unmask.
Two supported routes, in order of preference:

```bash
# Recommended: the bundled TUNED profile (tighter than unconfined) + proc unmask.
docker run \
  --security-opt seccomp=deploy/seccomp/checkstack-userns.json \
  --security-opt systempaths=unconfined \
  ghcr.io/enyineer/checkstack:latest

# Fallback if you cannot mount the profile file:
docker run \
  --security-opt seccomp=unconfined \
  --security-opt systempaths=unconfined \
  ghcr.io/enyineer/checkstack:latest
```

The tuned profile lives at
[`deploy/seccomp/checkstack-userns.json`](https://github.com/enyineer/checkstack/blob/main/deploy/seccomp/checkstack-userns.json).
It keeps `defaultAction: SCMP_ACT_ALLOW` (so the full Bun/Node + `sh` + `bwrap` +
`nftables` syscall set is permitted) and explicitly ERRNOs the dangerous
syscalls the runtime default blocks (kernel-module load/unload, `reboot`,
`kexec`, `swapon`, raw `bpf`/`perf_event_open`, `ptrace`, clock mutation, ...) so
it stays TIGHTER than `unconfined`. The same JSON works as a Kubernetes
`localhostProfile`.

The profile is VALIDATED in-container, not best-effort: it is checked against a
real syscall trace of the full `DEFAULT_SANDBOX_PROFILE` flow (both runners +
`bwrap` + `prlimit` + `nft`, filesystem + network + privilege + resources
including the per-run fork-bomb cap). Every syscall the flow needs is permitted
(zero denials of a needed syscall), the flow runs to success with all layers
`enforced` and zero downgrades, and a dangerous syscall is genuinely blocked
(for example `delete_module` returns `EPERM` under this profile versus `ENOSYS`
under `unconfined`, proving the seccomp filter is the blocker).

The `/proc` unmask is required and safe. Without it bwrap cannot mount the FRESH
`/proc` it needs inside the namespace (`bwrap: Can't mount proc on
/newroot/proc`). Binding the host `/proc` instead would work but is rejected: it
exposes host process info to the script. The unmask only lets bwrap mount its
own `/proc`; the sandboxed script runs in a fresh PID + mount namespace as
non-root and never sees the host `/proc` (verified: a script cannot read the
supervisor's environment via `/proc/<pid>/environ`).

The shipped `docker-compose.yml` sets both relaxations
(`seccomp=deploy/seccomp/checkstack-userns.json` and `systempaths=unconfined`),
and [`deploy/k8s/checkstack-sandbox.yaml`](https://github.com/enyineer/checkstack/blob/main/deploy/k8s/checkstack-sandbox.yaml)
is a ready Deployment with the `Localhost` seccomp profile and `procMount:
Unmasked` securityContext, plus a memory limit (shell scripts have no per-run
memory cap) and `runAsNonRoot`/`runAsUser: 65532`. An operator using the shipped
images plus these manifests gets the secure sandbox working without setting
anything to `unconfined` or hand-tuning.

> [!IMPORTANT]
> If your platform can relax NEITHER seccomp nor `/proc`, switch the global
> policy to `degrade` in the admin settings (an explicit, audited operator
> decision) so runs proceed under the portable subset instead of being refused.

#### Verified in-container

The sandbox is verified end-to-end in-container under the shipped tuned seccomp
profile + `systempaths=unconfined`:

- The supervisor is non-root (`id -u` == 65532), rootless `bwrap` engages, and
  filesystem + network + privilege + resources all report `enforced` with ZERO
  downgrades; a trivial shell AND ESM script both SUCCEED under the fail-closed
  `DEFAULT_SANDBOX_PROFILE` (the script runs as 65532, writes to its scratch
  dir, and cannot reach host root or read the supervisor's `/proc` environ).
- An aggressive fork bomb through both runners (shell `:(){ :|:& };:` and an ESM
  spawn loop) is CAPPED by the per-run RLIMIT_NPROC inside the bwrap user
  namespace and the supervisor stays alive and able to fork. This is pinned by
  the `forkbomb.it.test.ts` integration test (gated behind `CHECKSTACK_IT=1`,
  auto-skipped where the host lacks the primitives).
- The seccomp profile is validated against a real syscall trace: no needed
  syscall is denied, and a dangerous syscall (`delete_module`) is blocked.
- The live user-namespace probe reports `false` under the default Docker seccomp
  (so the run is correctly refused under fail-closed) and `true` with the tuned
  profile (so the layers enforce).

To re-verify a built image yourself, run a probe that prints
`detectSandboxCapabilities()` and executes a trivial script AND a fork bomb
through both runners under the default profile, asserting every layer is
`enforced` with zero downgrades, that `id -u` == 65532 inside the run, and that
the supervisor survives the bomb.

## Environment hardening

When the sandbox is enabled, forbidden env keys supplied by a check or action
are dropped before the child starts: `LD_PRELOAD`, `LD_LIBRARY_PATH`,
`LD_AUDIT`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `NODE_OPTIONS`,
`BUN_INSTALL`, any `BUN_CONFIG_*`, and a caller `PATH` override. The curated safe
`PATH` is still forwarded. When the sandbox is globally disabled
(`{ enabled: false }`) the denylist is not applied, preserving the exact prior
behavior.

## Satellite runtime

Health checks can run centrally (on the core pod) or on a satellite. The core
pod reads the single durable global policy from the shared database and wires it
as the policy provider. A satellite has no database connection, so it cannot
read the policy directly; the core RELAYS it over the already-authenticated
satellite WebSocket channel:

- **On connect.** The `authenticated` message carries the resolved
  `sandboxPolicy` (alongside the assignments), so a satellite enforces the
  operator's cluster-wide policy from its very first run. This is also the
  durable backstop: a satellite that missed a change push picks up the current
  policy on its next (re)connect.
- **On change.** When an admin saves a new policy, the core emits a cluster-wide
  `script-sandbox.policy-changed` hook; every core pod's broadcast subscriber
  pushes a `sandbox_policy` message to its own connected satellites, which
  replace their cached policy immediately.

Both the connect-time field and the push message are typed with the same
`sandboxPolicySchema` as the rest of the system.

### Fail closed until relay

A satellite caches the last relayed policy and resolves every run through it.
Until the FIRST policy is received, the satellite's provider returns the
fail-closed profile (deny egress, scratch filesystem plus read-only managed
packages, privilege drop) - NEVER the permissive shipped default. A satellite
must never run a script with a looser policy than core relayed, and before the
first relay there is no relayed policy, so it denies. Trust is established by the
authenticated WebSocket connection. If the core's policy read fails when
building the `authenticated` message, the field is simply omitted (version-skew
safe) and the satellite stays fail-closed - a relay failure can never loosen a
satellite's sandbox.

### Deploying a satellite (sandbox flags)

A satellite executes the same script checks as the core, so its container needs
the SAME two runtime relaxations described under
[Required runtime relaxations](#required-runtime-relaxations-both): a seccomp
profile that permits the unprivileged user-namespace + `bwrap` syscalls, and
`systempaths=unconfined`. Without them the fail-closed sandbox refuses every
script run - the satellite still starts and connects, but script-based health
checks error instead of executing.

The Docker daemon reads `--security-opt seccomp=<file>` from a file on the
satellite HOST at container-create time, and a container cannot relax its own
seccomp from the inside. So the operator must place the profile on the host
BEFORE `docker run` - the satellite cannot fetch-and-apply it for itself at
runtime. To make this work offline / in air-gapped networks, the tuned profile
is bundled INSIDE the satellite image (version-matched to the agent) and the
image exposes a `print-seccomp` helper that writes it to stdout - no GitHub and
no core round-trip required:

```bash
# Extract the profile once on the satellite host:
docker run --rm ghcr.io/enyineer/checkstack-satellite:latest \
  print-seccomp > checkstack-userns.json

# Then start the satellite with both relaxations:
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

A ready-to-edit [`docker-compose-satellite.yml`](https://github.com/enyineer/checkstack/blob/main/docker-compose-satellite.yml)
ships the same configuration, and the step-by-step
[Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/) guide
walks an operator through it. If the host can mount no profile file at all, the
fallback is `--security-opt seccomp=unconfined` (still non-root and
namespace-confined); if it can relax neither seccomp nor `/proc`, set the global
sandbox policy to `degrade` in the core admin settings.
