import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

/**
 * Per-process detection of which sandbox primitives the host kernel / process
 * actually supports. Cached at module init (see {@link detectSandboxCapabilities})
 * so it is computed ONCE per process — a per-run probe would tax every health
 * check.
 *
 * State-and-scale note: this is deterministic per-host capability detection,
 * not shared queryable state. A Linux pod and a macOS satellite can legitimately
 * report different capabilities; that divergence is surfaced per run (see the
 * EffectiveSandbox report), never assumed uniform.
 */
export interface SandboxCapabilities {
  platform: "linux" | "darwin" | "other";
  /** Can we drop privilege via setuid? (euid is root) */
  euidIsRoot: boolean;
  /** util-linux `prlimit` is on PATH. */
  hasPrlimit: boolean;
  /**
   * Can we set rlimits without an external wrapper? True when `prlimit` is
   * available (Phase 1 uses `prlimit` as the rlimit mechanism). Native
   * `setrlimit` from inside the spawned child is a later refinement.
   */
  rlimitNative: boolean;
  /** First namespace-capable wrapper found on PATH (Phase 2+ uses this). */
  wrapper: "bwrap" | "nsjail" | "firejail" | null;
  /**
   * Unprivileged user namespaces are usable (Phase 2+).
   *
   * This is the LIVE verdict: it reflects whether `clone(CLONE_NEWUSER)` (via a
   * real `unshare --user` probe) actually succeeds on THIS host at THIS moment,
   * NOT merely the static `unprivileged_userns_clone` sysctl toggle. The two can
   * disagree: under the default Docker/containerd seccomp profile the sysctl
   * file is absent (so the static toggle reads "available") while the live
   * `clone(CLONE_NEWUSER)` is blocked by seccomp, so bwrap would fail at spawn.
   * Driving this off the live probe closes that truthfulness gap — a layer that
   * needs a user namespace (filesystem confinement, any net namespace) is only
   * reported enforceable when the namespace can genuinely be created. See
   * {@link userNsCreatable}.
   */
  userNamespaces: boolean;
  /**
   * A network namespace can actually be DELIVERED via the chosen wrapper
   * (Phase 3+). Only `bwrap` / `nsjail` are used to create the per-run net
   * namespace here; `firejail`'s profile model is not used to deliver it, so a
   * firejail-only host reports `false` even though the kernel supports netns.
   * This guards against claiming a capability we cannot actually deliver.
   *
   * TRUTHFULNESS: this is gated on the LIVE `clone(CLONE_NEWUSER | CLONE_NEWNET)`
   * probe ({@link userNsCreatable}), NOT the static sysctl toggle. On a host
   * where the live clone is blocked (default Docker seccomp) this is `false`
   * even though a delivering wrapper is on PATH — so the network layer reports
   * `enforced.network = false` + a downgrade (under fail-closed the run is
   * refused) instead of falsely claiming enforcement while bwrap fails at spawn.
   *
   * IMPORTANT: a fresh net namespace is ROUTELESS — it has loopback only and no
   * path to the host network. This capability therefore only enables `deny`
   * (loopback-only IS the goal). Reaching real destinations under `allowlist`
   * (or applying a meaningful metadata block while keeping egress) additionally
   * requires {@link netEgressIface} — see that field.
   */
  netNamespaces: boolean;
  /**
   * The LIVE probe verdict: can an unprivileged user+net namespace actually be
   * CREATED on this host right now (`clone(CLONE_NEWUSER | CLONE_NEWNET)` via an
   * `unshare --user --net` child succeeds)? This is the single source of truth
   * for "can we make a namespace", consumed by {@link userNamespaces},
   * {@link netNamespaces}, and {@link netEgressRootless} so they never diverge.
   * Probed ONCE per process (folded into the cached detection); never per run.
   */
  userNsCreatable: boolean;
  /**
   * The host interface name that can plumb real egress INTO the child's net
   * namespace (via `nsjail --macvlan_iface`), or `null` when egress cannot be
   * plumbed on this host.
   *
   * Plumbing requires ALL of: a filter-capable wrapper (`nsjail`), the
   * privilege to configure interfaces in the new namespace (CAP_NET_ADMIN —
   * approximated here by euid root), and a usable non-loopback host interface.
   * When this is `null`, `allowlist` and the keep-egress-but-block-metadata
   * cases CANNOT be delivered without blackholing all traffic, so they
   * degrade-and-surface to host net rather than engage a routeless namespace.
   */
  netEgressIface: string | null;
  /**
   * Static addressing for the child's macvlan endpoint, or `null` when it is
   * not configured. A macvlan interface created inside the namespace comes up
   * UNCONFIGURED — without an IP / netmask / default gateway it has no route, so
   * `--macvlan_iface` ALONE still blackholes egress. nsjail addresses it with
   * `--macvlan_vs_ip` / `--macvlan_vs_nm` / `--macvlan_vs_gw`.
   *
   * Reliably deriving a free address + the default gateway from the host is a
   * genuine TOCTOU / collision footgun (the default route is not exposed by
   * `os.networkInterfaces()`, and auto-picking an IP risks a clash), so v1 takes
   * it EXPLICITLY from the operator via `CHECKSTACK_SANDBOX_MACVLAN_IP` /
   * `_NM` / `_GW`. When unset, `allowlist` / metadata-block under a netns
   * degrade-and-surface to host net rather than route into an unaddressed
   * (blackholing) macvlan. This is the documented v1 allowlist-reachability
   * limitation.
   */
  netEgressAddressing: MacvlanAddressing | null;
  /**
   * A ROOTLESS userspace egress path can be plumbed into the child's net
   * namespace via `slirp4netns`, for hosts that have NO privileged macvlan path
   * (`netEgressIface === null`) but DO have unprivileged user namespaces — the
   * common rootless-container case (rootless Podman/Docker).
   *
   * Unlike macvlan, this needs NO CAP_NET_ADMIN, NO host uplink interface, and
   * NO operator-supplied addressing: `slirp4netns` provides a userspace TCP/IP
   * stack and a `tap0` device inside the child's netns with DETERMINISTIC,
   * built-in static addressing (`10.0.2.0/24`, child `10.0.2.100`, gateway
   * `10.0.2.2`), so there is no TOCTOU/collision footgun to defer to the
   * operator. Egress is NAT'd out through the parent's network namespace.
   *
   * Gated on ALL of: Linux + unprivileged user namespaces usable + a userns
   * netns can actually be created (`clone(CLONE_NEWUSER | CLONE_NEWNET)` works,
   * probed once) + `slirp4netns` present on PATH + a wrapper that can deliver
   * the namespace AND expose the child PID to the parent so `slirp4netns` can
   * attach race-free (only `bwrap`, via `--info-fd`, is used for this here).
   *
   * The nftables allowlist + always-on metadata block are filtered INSIDE this
   * namespace exactly as on the macvlan path. The filter is loaded fail-closed
   * (default-drop egress is installed BEFORE `tap0` comes up), so a slirp4netns
   * that never readies leaves the child with no reachable egress rather than an
   * unfiltered one — egress is never unfiltered while `enforced.network` is true.
   *
   * When `false`, `allowlist` / metadata-block fall back to the macvlan path if
   * available, else degrade-and-surface to host net (never a blackhole).
   */
  netEgressRootless: boolean;
}

/** Static addressing for the child's macvlan egress endpoint (nsjail). */
export interface MacvlanAddressing {
  /** Endpoint IP inside the child's namespace (`--macvlan_vs_ip`). */
  ip: string;
  /** Netmask for the endpoint (`--macvlan_vs_nm`). */
  netmask: string;
  /** Default gateway reachable from the endpoint (`--macvlan_vs_gw`). */
  gateway: string;
}

/** Env vars supplying the macvlan endpoint addressing (see {@link MacvlanAddressing}). */
export const MACVLAN_IP_ENV = "CHECKSTACK_SANDBOX_MACVLAN_IP";
export const MACVLAN_NM_ENV = "CHECKSTACK_SANDBOX_MACVLAN_NM";
export const MACVLAN_GW_ENV = "CHECKSTACK_SANDBOX_MACVLAN_GW";

/**
 * Read the operator-supplied macvlan addressing from the environment. All three
 * of IP / netmask / gateway must be present and non-empty; a partial config is
 * treated as "not configured" (so the allowlist degrades-and-surfaces rather
 * than routing into a half-addressed endpoint).
 */
function detectMacvlanAddressing(): MacvlanAddressing | null {
  const ip = process.env[MACVLAN_IP_ENV]?.trim();
  const netmask = process.env[MACVLAN_NM_ENV]?.trim();
  const gateway = process.env[MACVLAN_GW_ENV]?.trim();
  if (
    ip === undefined ||
    ip === "" ||
    netmask === undefined ||
    netmask === "" ||
    gateway === undefined ||
    gateway === ""
  ) {
    return null;
  }
  return { ip, netmask, gateway };
}

function detectPlatform(): SandboxCapabilities["platform"] {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  return "other";
}

function detectEuidIsRoot(): boolean {
  // getuid is unavailable on Windows; treat absence as "cannot drop".
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return false;
  return getuid() === 0;
}

/** Whether a binary is resolvable on PATH (single `which`-style check). */
function hasBinaryOnPath(binary: string): boolean {
  // `command -v` is POSIX and avoids spawning a heavy shell pipeline. On
  // non-POSIX hosts this simply returns false (status !== 0).
  const result = spawnSync("sh", ["-c", `command -v ${binary}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function detectWrapper(): SandboxCapabilities["wrapper"] {
  for (const candidate of ["bwrap", "nsjail", "firejail"] as const) {
    if (hasBinaryOnPath(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * LIVE probe: can an unprivileged user+net namespace actually be CREATED on this
 * host right now? This is the truthful source for "can we make a namespace",
 * driving `userNamespaces` / `netNamespaces` / `netEgressRootless`.
 *
 * The static `unprivileged_userns_clone` sysctl ({@link detectUserNamespacesToggle})
 * is NOT sufficient on its own: the live `clone(CLONE_NEWUSER | CLONE_NEWNET)`
 * can fail independently of the toggle (a restrictive seccomp profile — the
 * default Docker/containerd one blocks unprivileged `clone(CLONE_NEW*)` /
 * `unshare`; `sysctl user.max_user_namespaces=0`; an AppArmor `userns`
 * restriction; a hardened kernel). On the common default-Docker-seccomp host the
 * sysctl file is absent (toggle reads "available") yet this clone is blocked, so
 * relying on the toggle alone falsely reports the namespace capability while
 * bwrap fails at spawn — the exact truthfulness gap this closes.
 *
 * We probe via `unshare --user --net --map-root-user true` (util-linux) — the
 * same syscalls the wrapper relies on (CLONE_NEWUSER + CLONE_NEWNET) — and treat
 * a zero exit as "creatable". A non-Linux platform, a missing `unshare` binary,
 * or any non-zero exit is `false`, so we never CLAIM a namespace path on a host
 * where the namespace cannot be made.
 *
 * The static toggle is still consulted FIRST as a cheap short-circuit: when it
 * is explicitly disabled (`= 0`) the namespace cannot be created regardless, so
 * we skip the spawn. Otherwise we run the live probe.
 *
 * Probed ONCE per process (folded into the cached capability detection); never
 * a per-run cost.
 */
function detectUserNsCreatable(
  platform: SandboxCapabilities["platform"],
): boolean {
  if (platform !== "linux") return false;
  // Cheap short-circuit: an explicitly-disabled sysctl can never create a
  // namespace, so skip the spawn. "absent" or non-zero falls through to the
  // live probe (absent does NOT imply available — the live clone decides).
  if (!detectUserNamespacesToggle()) return false;
  if (!hasBinaryOnPath("unshare")) return false;
  const result = spawnSync(
    "unshare",
    ["--user", "--net", "--map-root-user", "true"],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

/**
 * Read the classic Debian/Ubuntu `unprivileged_userns_clone` sysctl toggle.
 * This is ONLY a cheap pre-gate for {@link detectUserNsCreatable}: an explicit
 * `0` means disabled. A MISSING file does NOT prove the namespace is creatable
 * (the default Docker seccomp host has no file yet still blocks the clone), so
 * an absent file falls through to the live probe rather than being treated as
 * "available" on its own.
 */
function detectUserNamespacesToggle(): boolean {
  const togglePath = "/proc/sys/kernel/unprivileged_userns_clone";
  if (!existsSync(togglePath)) {
    // Absent: undecided here; the live clone probe is the real verdict.
    return true;
  }
  try {
    const value = readFileSync(togglePath, "utf8").trim();
    return value !== "0";
  } catch {
    return false;
  }
}

/**
 * Find a usable non-loopback host interface to plumb egress into the child's
 * net namespace via macvlan. Returns the first IPv4-or-IPv6, non-internal,
 * interface name, or `null` when none is usable.
 */
function detectEgressIface(platform: SandboxCapabilities["platform"]): string | null {
  if (platform !== "linux") return null;
  let ifaces: ReturnType<typeof networkInterfaces>;
  try {
    ifaces = networkInterfaces();
  } catch {
    return null;
  }
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (addrs === undefined) continue;
    // Skip loopback / internal interfaces; we need a real uplink.
    if (addrs.some((a) => !a.internal)) {
      return name;
    }
  }
  return null;
}

function computeCapabilities(): SandboxCapabilities {
  const platform = detectPlatform();
  const hasPrlimit = platform === "linux" ? hasBinaryOnPath("prlimit") : false;
  const wrapper = platform === "linux" ? detectWrapper() : null;
  // LIVE verdict: actually attempt `clone(CLONE_NEWUSER | CLONE_NEWNET)`. This is
  // the single source of truth for namespace creation, so `userNamespaces`,
  // `netNamespaces`, and `netEgressRootless` all agree and none claims a path
  // bwrap cannot actually take at spawn (default Docker seccomp blocks the clone
  // even though the static sysctl toggle reads "available").
  const userNsCreatable = detectUserNsCreatable(platform);
  const userNamespaces = userNsCreatable;
  const euidIsRoot = detectEuidIsRoot();
  // Only wrappers we actually use to create the per-run net namespace count:
  // bwrap (deny) and nsjail (deny + nftables allowlist). firejail is detected
  // for reporting but never delivers the namespace here, so a firejail-only
  // host must NOT claim netNamespaces it cannot deliver via the chosen wrapper.
  const wrapperDeliversNetns = wrapper === "bwrap" || wrapper === "nsjail";
  const netNamespaces = wrapperDeliversNetns && userNsCreatable;
  // Egress plumbing (macvlan) needs nsjail + CAP_NET_ADMIN (euid root) + a real
  // uplink interface. Without ALL three, a fresh netns is routeless and can
  // ONLY deliver `deny`; allowlist / keep-egress-with-metadata-block degrade.
  const netEgressIface =
    wrapper === "nsjail" && netNamespaces && euidIsRoot
      ? detectEgressIface(platform)
      : null;
  // The macvlan endpoint additionally needs static addressing to ROUTE (an
  // unaddressed macvlan still blackholes). Only meaningful when we actually
  // have a usable egress iface; taken explicitly from operator env (see
  // detectMacvlanAddressing).
  const netEgressAddressing =
    netEgressIface === null ? null : detectMacvlanAddressing();
  // Rootless egress (slirp4netns) is the fallback when the privileged macvlan
  // path is unavailable. It needs: a wrapper that exposes the child PID for a
  // race-free slirp4netns attach (only `bwrap --info-fd` is used here), an
  // actually-creatable unprivileged user+net namespace, and `slirp4netns` on
  // PATH. No CAP_NET_ADMIN, no host uplink, no operator addressing — the
  // userspace stack supplies deterministic addressing. We still gate on
  // `userNamespaces` (the static toggle) AND the live clone probe so we never
  // claim it where the namespace can't be made.
  const netEgressRootless =
    platform === "linux" &&
    wrapper === "bwrap" &&
    userNsCreatable &&
    hasBinaryOnPath("slirp4netns");
  return {
    platform,
    euidIsRoot,
    hasPrlimit,
    rlimitNative: hasPrlimit,
    wrapper,
    userNamespaces,
    netNamespaces,
    userNsCreatable,
    netEgressIface,
    netEgressAddressing,
    netEgressRootless,
  };
}

let cached: SandboxCapabilities | undefined;

/**
 * Detect (and cache for the process lifetime) the host's sandbox capabilities.
 * The first call performs the probes; subsequent calls return the cache.
 */
export function detectSandboxCapabilities(): SandboxCapabilities {
  cached ??= computeCapabilities();
  return cached;
}

/**
 * Test-only: clear the cache so a test can force a re-detection. Not part of
 * the production contract.
 */
export function __resetCapabilitiesCacheForTest(): void {
  cached = undefined;
}
