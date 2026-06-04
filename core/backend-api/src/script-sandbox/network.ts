import type { MacvlanAddressing, SandboxCapabilities } from "./capabilities";
import type { NetworkPolicy } from "./policy";

/**
 * Network egress control (plan §5.3 / §6 D3).
 *
 * Egress is filtered at the KERNEL — a network namespace — not at the language
 * runtime, so it covers `fetch`, raw sockets, DNS, and anything else the child
 * tries, uniformly. There is no app-level shim a script can bypass.
 *
 * Mechanism, delegated to the same external wrapper that delivers filesystem
 * isolation (external-wrapper-first, §6 D2):
 *
 *  - `deny`      = drop the child into a fresh network namespace with ONLY
 *                  loopback. A fresh netns is ROUTELESS — it has no path to the
 *                  host network — so "no egress" is the kernel default and that
 *                  is EXACTLY the goal. Deliverable by ANY namespace wrapper
 *                  (`bwrap --unshare-net`, `nsjail --clone_newnet`); no packet
 *                  filter is needed because there is nothing to filter.
 *  - `allowlist` = a fresh network namespace PLUS REAL EGRESS plumbed into it
 *                  PLUS an nftables ruleset that permits only the listed
 *                  IPv4/IPv6 CIDRs (and loopback) and rejects everything else.
 *                  The plumbing is the critical part: a fresh netns is
 *                  routeless, so without an uplink the allowlist would blackhole
 *                  ALL traffic (including the allowed CIDRs) — that is a silent
 *                  under-block, NOT enforcement. Egress is plumbed by ONE of two
 *                  paths, preferred in order:
 *                    1. PRIVILEGED macvlan (`nsjail` + CAP_NET_ADMIN + a usable
 *                       host interface + static addressing, i.e.
 *                       `caps.netEgressIface` + `caps.netEgressAddressing`); or
 *                    2. ROOTLESS slirp4netns (`bwrap` + creatable user+net
 *                       namespace + `slirp4netns`, i.e. `caps.netEgressRootless`)
 *                       — a userspace TCP/IP stack with deterministic built-in
 *                       addressing, needing NO privilege/uplink/operator config.
 *                  Either way the SAME nftables ruleset filters the plumbed
 *                  egress. When NEITHER path is available it DEGRADES (surfaced)
 *                  to host net — never a blackhole, never a silent allow-all.
 *  - `unrestricted` = keep the host network namespace. The ALWAYS-ON
 *                  metadata/link-local block (`denyLinkLocalAndMetadata`) needs
 *                  a netns WITH real egress so that everything EXCEPT the
 *                  blocked ranges still reaches the network. If egress can be
 *                  plumbed, the block is realised as a default-accept-except-
 *                  metadata ruleset inside a plumbed namespace. If it CANNOT be
 *                  plumbed (`bwrap`-only, no uplink, non-root), engaging a
 *                  routeless netns would sever ALL egress — so we DO NOT engage
 *                  one: we keep host net and surface the block as unenforceable.
 *
 * INVARIANT: a routeless fresh netns is used ONLY for `deny`. `unrestricted`
 * and `allowlist` either get real plumbed + filtered egress, or degrade to
 * surfaced host net. `enforced.network` reflects reality — it is never true
 * when egress is actually severed or unfiltered.
 *
 * IP/CIDR only for v1 (§6 D3). Domain allowlisting (DNS-aware) is a v2 concern.
 */

/**
 * Always-blocked destinations, even in `unrestricted`/`allowlist` mode when
 * `denyLinkLocalAndMetadata` is on. Covers IPv4 link-local + the cloud-metadata
 * endpoint and the IPv6 link-local / unique-local ranges (the IPv6 metadata
 * alias `fd00:ec2::254` falls inside `fc00::/7`).
 */
export const ALWAYS_BLOCKED_CIDRS = [
  // IPv4 link-local — includes 169.254.169.254 (AWS/GCP/Azure/OpenStack metadata).
  "169.254.0.0/16",
  // IPv6 link-local.
  "fe80::/10",
  // IPv6 unique-local — covers fd00:ec2::254 (IMDS over IPv6) and similar.
  "fc00::/7",
] as const;

/** Loopback ranges always permitted (the child's own localhost). */
const LOOPBACK_CIDRS = ["127.0.0.0/8", "::1/128"] as const;

/**
 * The net behaviour the wrapper must deliver, resolved from policy + caps.
 * Consumed by the namespace composer in `wrapper.ts`/`filesystem.ts`.
 */
export type NetworkDecision =
  | {
      /** Keep the host net namespace; no kernel filter applied. */
      kind: "host";
      /**
       * True when the metadata/link-local block was REQUESTED but cannot be
       * enforced without a netns + nftables on this host. The caller surfaces
       * this as a downgrade. When false, nothing was requested (or it is moot).
       */
      metadataBlockUnenforceable: boolean;
    }
  | {
      /**
       * Drop into a fresh net namespace. For `deny` this is routeless
       * (loopback only) and that is the goal. For `allowlist` it is plumbed
       * with `egressIface` and filtered by `nftRuleset`.
       */
      kind: "namespaced";
      mode: "deny" | "allowlist";
      /**
       * How real egress is plumbed into the namespace for `allowlist`:
       *  - `"macvlan"`  — privileged nsjail macvlan uplink (`egressIface` +
       *                   `egressAddressing` present);
       *  - `"rootless"` — unprivileged slirp4netns userspace stack (no iface /
       *                   addressing; the launcher orchestrates it).
       * Absent for `deny` (a routeless namespace IS the goal — no plumbing).
       */
      egressPath?: "macvlan" | "rootless";
      /**
       * An nftables ruleset to install inside the child's namespace, or
       * undefined for pure `deny` (a loopback-only routeless netns needs no
       * rules — there is no route out to filter). Present for `allowlist` (incl.
       * the metadata-only block realised as an allowlist-shaped ruleset).
       */
      nftRuleset?: string;
      /**
       * The host interface to plumb real egress into the namespace via macvlan.
       * Present (and required) for `allowlist` via the MACVLAN path — without it
       * the namespace is routeless and the allowlist would blackhole everything.
       * Absent for `deny` (routeless IS the goal) and for the ROOTLESS path
       * (slirp4netns needs no host iface).
       */
      egressIface?: string;
      /**
       * Static addressing for the macvlan endpoint (`--macvlan_vs_ip/_nm/_gw`).
       * Present alongside `egressIface` for the MACVLAN `allowlist` /
       * metadata-block; a macvlan with no address still blackholes, so
       * addressing is REQUIRED to route and the macvlan decision only reaches
       * `namespaced` allowlist when it is available. Absent for the ROOTLESS
       * path (slirp4netns has deterministic built-in addressing).
       */
      egressAddressing?: MacvlanAddressing;
    }
  | {
      /** Could not enforce as requested; caller degrades or fails. */
      kind: "degrade";
      reason: string;
    };

/**
 * Build the nftables ruleset installed inside the child's network namespace.
 *
 * For `allowlist`: default-drop egress, then accept loopback, accept the listed
 * CIDRs, and (independently of the allowlist) drop the always-blocked
 * metadata/link-local ranges so a CIDR that overlaps them cannot re-open the
 * hole.
 *
 * For the `unrestricted` metadata block: default-accept egress, but drop the
 * always-blocked ranges.
 */
export function buildEgressNftRules({
  mode,
  allow,
  denyMetadata,
}: {
  mode: "allowlist" | "metadata-only";
  allow: string[];
  denyMetadata: boolean;
}): string {
  const v4Allow: string[] = [];
  const v6Allow: string[] = [];
  for (const cidr of allow) {
    (isIpv6Cidr(cidr) ? v6Allow : v4Allow).push(cidr);
  }
  const blocked = denyMetadata ? [...ALWAYS_BLOCKED_CIDRS] : [];
  const v4Blocked = blocked.filter((c) => !isIpv6Cidr(c));
  const v6Blocked = blocked.filter((c) => isIpv6Cidr(c));

  // Always reject the metadata/link-local ranges FIRST so neither an explicit
  // allow entry nor the default-accept (metadata-only) can reach them.
  const blockLines: string[] = [
    ...(v4Blocked.length > 0 ? [`    ip daddr { ${v4Blocked.join(", ")} } drop`] : []),
    ...(v6Blocked.length > 0 ? [`    ip6 daddr { ${v6Blocked.join(", ")} } drop`] : []),
  ];

  // For allowlist: loopback is always reachable (the child's own services),
  // then the explicit allow entries, then a final default drop.
  const allowLines: string[] =
    mode === "allowlist"
      ? [
          `    ip daddr { ${LOOPBACK_CIDRS[0]} } accept`,
          `    ip6 daddr { ${LOOPBACK_CIDRS[1]} } accept`,
          ...(v4Allow.length > 0 ? [`    ip daddr { ${v4Allow.join(", ")} } accept`] : []),
          ...(v6Allow.length > 0 ? [`    ip6 daddr { ${v6Allow.join(", ")} } accept`] : []),
          "    drop",
        ]
      : [];

  const lines: string[] = [
    "table inet checkstack_egress {",
    "  chain output {",
    "    type filter hook output priority 0; policy accept;",
    ...blockLines,
    ...allowLines,
    "  }",
    "}",
  ];
  return lines.join("\n");
}

/** Crude IPv4-vs-IPv6 CIDR discriminator: IPv6 literals contain a colon. */
function isIpv6Cidr(cidr: string): boolean {
  return cidr.includes(":");
}

/**
 * Resolve WHICH plumbed-egress path is deliverable on this host, preferring the
 * privileged macvlan path over the rootless slirp4netns path. Returns `null`
 * when NEITHER is available (the caller then degrades-and-surfaces — never a
 * blackhole). Pure; reads only the pre-detected caps.
 */
type EgressPlumbing =
  | { path: "macvlan"; iface: string; addressing: MacvlanAddressing }
  | { path: "rootless" };

function resolveEgressPlumbing(caps: SandboxCapabilities): EgressPlumbing | null {
  // 1. Privileged macvlan: needs the iface AND static addressing (an
  //    unaddressed macvlan blackholes). Preferred when available.
  if (caps.netEgressIface !== null && caps.netEgressAddressing !== null) {
    return {
      path: "macvlan",
      iface: caps.netEgressIface,
      addressing: caps.netEgressAddressing,
    };
  }
  // 2. Rootless slirp4netns: no privilege / uplink / operator addressing
  //    required; the launcher orchestrates a userspace stack with deterministic
  //    addressing and filters it with the same nftables ruleset.
  if (caps.netEgressRootless) {
    return { path: "rootless" };
  }
  return null;
}

/**
 * Resolve the network layer for a run. Pure & synchronous (no probing — caps
 * are pre-detected and cached upstream).
 *
 * The caller (the namespace composer) maps the decision onto wrapper flags:
 *  - `host`        → keep the host net (`--share-net` / `--disable_clone_newnet`).
 *  - `namespaced`  → create a net namespace (`--unshare-net` /
 *                    `--clone_newnet`) and, when `nftRuleset` is set, install it.
 *  - `degrade`     → drop network control to the host net (default) or refuse
 *                    (`onUnavailable: "fail"`), per the caller.
 */
export function buildNetworkLayer({
  policy,
  caps,
}: {
  policy: NetworkPolicy;
  caps: SandboxCapabilities;
}): NetworkDecision {
  // --- unrestricted: only the always-on metadata block may apply ----------
  if (policy.mode === "unrestricted") {
    if (!policy.denyLinkLocalAndMetadata) {
      // Nothing requested at the network layer: pure host net, nothing to do.
      return { kind: "host", metadataBlockUnenforceable: false };
    }
    // The metadata/link-local block must keep ordinary egress WORKING while
    // dropping only the blocked ranges. That requires a netns WITH real egress
    // plumbed in (a routeless OR unaddressed namespace would sever ALL traffic —
    // a blackhole, not a block). Engage a namespace only when egress can
    // actually be plumbed (privileged macvlan OR rootless slirp4netns);
    // otherwise keep host net and surface the block as unenforceable. NEVER
    // engage a routeless/unaddressed netns here (that is the BLOCKER this
    // guards against).
    const plumbing = resolveEgressPlumbing(caps);
    if (plumbing !== null) {
      const nftRuleset = buildEgressNftRules({
        mode: "metadata-only",
        allow: [],
        denyMetadata: true,
      });
      return plumbing.path === "macvlan"
        ? {
            kind: "namespaced",
            mode: "allowlist",
            egressPath: "macvlan",
            egressIface: plumbing.iface,
            egressAddressing: plumbing.addressing,
            nftRuleset,
          }
        : {
            kind: "namespaced",
            mode: "allowlist",
            egressPath: "rootless",
            nftRuleset,
          };
    }
    return { kind: "host", metadataBlockUnenforceable: true };
  }

  // --- deny: a routeless fresh netns IS the goal --------------------------
  if (policy.mode === "deny") {
    if (caps.platform !== "linux") {
      return {
        kind: "degrade",
        reason: `network deny requires Linux net namespaces (platform=${caps.platform}); egress unrestricted`,
      };
    }
    if (!caps.netNamespaces) {
      return {
        kind: "degrade",
        reason:
          "network deny requires a net-namespace-capable wrapper (bwrap/nsjail) + unprivileged user namespaces, unavailable on this host; egress unrestricted",
      };
    }
    // Loopback-only routeless namespace = no egress. No filter, no plumbing.
    return { kind: "namespaced", mode: "deny" };
  }

  // --- allowlist: needs a fresh netns WITH plumbed egress + a filter ------
  if (caps.platform !== "linux") {
    return {
      kind: "degrade",
      reason: `network allowlist requires Linux net namespaces (platform=${caps.platform}); egress unrestricted`,
    };
  }
  if (!caps.netNamespaces) {
    return {
      kind: "degrade",
      reason:
        "network allowlist requires a net-namespace-capable wrapper + unprivileged user namespaces, unavailable on this host; egress unrestricted",
    };
  }
  // EMPTY allowlist == deny ALL egress. This is the SECURE DEFAULT
  // (`network: allowlist, allow: []`). Semantically it permits nothing, so it is
  // exactly the `deny` routeless-namespace behaviour: loopback only, no route
  // out. Resolve it to the routeless `deny` path, which needs NEITHER plumbed
  // egress (slirp4netns/macvlan) NOR an nftables ruleset, and therefore works on
  // ANY host with a net-namespace-capable wrapper - including rootless
  // containers where in-namespace nftables is not permitted. A routeless netns
  // also inherently blocks metadata/link-local (nothing routes), so the always-
  // on block is satisfied. Non-empty allow lists still take the plumbed+filtered
  // path below (which requires macvlan or rootless slirp4netns + working nft).
  if (policy.allow.length === 0) {
    return { kind: "namespaced", mode: "deny" };
  }
  const plumbing = resolveEgressPlumbing(caps);
  if (plumbing === null) {
    // The wrapper can create the namespace, but we cannot plumb real egress
    // into it by EITHER path:
    //  - privileged macvlan needs nsjail + CAP_NET_ADMIN + a usable host iface +
    //    static addressing (CHECKSTACK_SANDBOX_MACVLAN_IP/_NM/_GW);
    //  - rootless slirp4netns needs bwrap + a creatable user+net namespace +
    //    slirp4netns on PATH.
    // A routeless netns would blackhole the allowed CIDRs too — a silent
    // under-block, not enforcement — so degrade-and-surface to host net.
    return {
      kind: "degrade",
      reason:
        "network allowlist requires plumbing real egress into the namespace, by EITHER the privileged macvlan path (nsjail + CAP_NET_ADMIN + a usable host interface + CHECKSTACK_SANDBOX_MACVLAN_IP/_NM/_GW addressing) OR the rootless path (bwrap + an unprivileged user+net namespace + slirp4netns on PATH); this host can deliver neither, and a routeless namespace would blackhole the allowed destinations; egress unrestricted",
    };
  }

  const nftRuleset = buildEgressNftRules({
    mode: "allowlist",
    allow: policy.allow,
    denyMetadata: policy.denyLinkLocalAndMetadata,
  });
  return plumbing.path === "macvlan"
    ? {
        kind: "namespaced",
        mode: "allowlist",
        egressPath: "macvlan",
        egressIface: plumbing.iface,
        egressAddressing: plumbing.addressing,
        nftRuleset,
      }
    : {
        kind: "namespaced",
        mode: "allowlist",
        egressPath: "rootless",
        nftRuleset,
      };
}
