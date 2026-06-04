import { existsSync, realpathSync } from "node:fs";
import type { SandboxCapabilities } from "./capabilities";
import type { NetworkDecision } from "./network";
import type { FilesystemPolicy } from "./policy";

/**
 * Filesystem isolation (plan §5.2) composed with network egress control
 * (plan §5.3). Both are delivered by the SAME namespace-capable external
 * wrapper (`bwrap` first, then `nsjail`) per the external-wrapper-first
 * decision (§6 / D2): re-implementing unprivileged mount/user/net namespaces
 * natively is a large, security-critical surface, and these tools are small,
 * audited, and built exactly for this.
 *
 * Filesystem modes:
 *  - `scratch-only`: the child sees a minimal read-only base system
 *    (`/usr`, `/bin`, `/lib`, `/lib64`, `/etc`) plus its per-run scratch dir
 *    mounted read-write. Everything else on the host FS is invisible.
 *  - `scratch-plus-ro`: `scratch-only` PLUS a read-only bind of the reconciled
 *    `resolutionRoot/node_modules` so managed-package imports still resolve.
 *
 * Network composition (Phase 3): the FS wrapper used to hard-code
 * `--share-net` / `--disable_clone_newnet` to keep the host network namespace,
 * because network was a separate, not-yet-built layer. Now the FS and network
 * layers COMPOSE in one wrapper invocation: when the resolved
 * {@link NetworkDecision} keeps the host net we still emit `--share-net`; when
 * it asks for a fresh namespace we emit the net-unshare flags (and, for
 * `nsjail`, install the egress nftables ruleset). A network-only run (FS
 * `off` but `network.deny`/`allowlist`) still produces a wrapper invocation so
 * the namespace can be created.
 *
 * `firejail` is detected for capability reporting but never used to DELIVER
 * namespaces here (its profile model does not map onto the per-run bind/net set
 * we build), so a firejail-only host degrades both layers (surfaced).
 */

/** Inputs the runner supplies for the FS layer of a single run. */
export interface FilesystemRunInputs {
  /**
   * Per-run writable scratch directory (the ESM runner's `mkdtemp` dir). The
   * child's CWD. Required to build any FS confinement — without a scratch dir
   * there is nothing safe to make writable, so the FS layer degrades. A
   * network-only run (no FS confinement) does not need it.
   */
  scratchDir?: string;
  /**
   * Absolute path to the reconciled `node_modules` tree to expose read-only
   * under `scratch-plus-ro`. When the resolution root is unset (the ESM runner
   * was given no `resolutionRoot`), there are no managed packages to bind.
   */
  nodeModulesDir?: string;
  /**
   * Absolute path to the language interpreter the runner execs (e.g.
   * `process.execPath` for the ESM runner's Bun runtime). Under FS confinement
   * the host FS is hidden, so the interpreter binary — which commonly lives
   * outside `/usr`/`/bin` (e.g. `~/.bun/bin/bun`, `/usr/local/bin/bun`) — must
   * be read-only bound into the namespace or the child cannot exec the runtime.
   * The shell runner omits it (`sh` resolves from the bound `/bin`).
   */
  interpreterPath?: string;
  /**
   * The dedicated low-privilege UID/GID to drop to via the NAMESPACE WRAPPER
   * (`bwrap --uid/--gid`, `nsjail --user/--group`). Set ONLY on the legacy
   * ROOT-supervisor path: a root supervisor needs the wrapper to map the child
   * to a dedicated low-priv id. It is left UNSET under the shipped NON-ROOT
   * supervisor model, where the child INHERITS the supervisor's non-root uid by
   * construction (and a rootless `--uid` to a DIFFERENT id is impossible without
   * subuid/newuidmap, and unnecessary). The runner never passes `uid`/`gid` to
   * `Bun.spawn` either: Bun silently ignores those, and honouring them would
   * spawn the wrapper itself as the dropped id and break userns creation.
   */
  dropUid?: number;
  dropGid?: number;
}

export type FilesystemBuildResult =
  | { kind: "off" }
  | {
      kind: "enforced";
      /** argv prelude that wraps the real command (e.g. `bwrap ... --`). */
      prelude: string[];
    }
  | {
      /**
       * The ROOTLESS egress path: the wrapper cannot be a plain argv prelude
       * because `slirp4netns` must be orchestrated from OUTSIDE the namespace
       * (in the parent netns) with a race-free PID + ready handshake. So this
       * returns the `bwrap` argv (WITHOUT the trailing `--`) for
       * {@link buildSpawnHardening} to fold into a generated launcher script
       * (see `rootless-egress.ts`), which is staged on disk and exec'd as the
       * actual prelude. The launcher wires the nft filter (fail-closed) + the
       * slirp4netns userspace stack into the same namespace.
       */
      kind: "enforced-rootless-egress";
      /** `bwrap` argv WITHOUT the trailing `--` (the launcher appends it). */
      bwrapArgv: string[];
    }
  | { kind: "degrade"; reason: string };

/**
 * Read-only base system paths exposed inside the namespace so ordinary
 * binaries (`sh`, coreutils) and their shared libraries resolve. Only paths
 * that exist on the host are bound; a missing path is skipped (e.g. `/lib64` is
 * absent on some distros). The language interpreter is bound separately (it may
 * live outside these roots).
 */
const RO_BASE_PATHS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] as const;

/**
 * Resolve the interpreter to a stable real path and dedupe it against the
 * read-only base binds. Returns undefined when there is nothing extra to bind
 * (no interpreter given, or it already lives under a bound base path).
 */
function resolveInterpreterBind({
  interpreterPath,
  pathExists,
  realpath,
}: {
  interpreterPath: string | undefined;
  pathExists: (path: string) => boolean;
  realpath: (path: string) => string;
}): string | undefined {
  if (interpreterPath === undefined) {
    return undefined;
  }
  let resolved: string;
  try {
    resolved = realpath(interpreterPath);
  } catch {
    resolved = interpreterPath;
  }
  if (!pathExists(resolved)) {
    return undefined;
  }
  // Already covered by a RO base bind → no separate bind needed.
  if (RO_BASE_PATHS.some((base) => resolved === base || resolved.startsWith(`${base}/`))) {
    return undefined;
  }
  return resolved;
}

/**
 * Build a `bwrap` argv prelude. Confines the child to `scratchDir` (read-write)
 * over a read-only minimal base system when FS confinement is on, and applies
 * the resolved network decision: `--share-net` to keep the host net, or
 * `--unshare-net` for a fresh (deny / nsjail-handled) namespace.
 */
function buildBwrapPrelude({
  fsConfinement,
  scratchDir,
  nodeModulesDir,
  interpreterBind,
  net,
  dropUid,
  dropGid,
  pathExists,
  terminate = true,
}: {
  fsConfinement: boolean;
  scratchDir: string | undefined;
  nodeModulesDir: string | undefined;
  interpreterBind: string | undefined;
  net: NetworkDecision;
  /** Low-priv UID/GID to drop to inside the namespace (`bwrap --uid/--gid`). */
  dropUid: number | undefined;
  dropGid: number | undefined;
  pathExists: (path: string) => boolean;
  /**
   * Append the trailing `--` that separates the bwrap flags from the child
   * argv. True for the ordinary argv-prelude path; FALSE for the rootless
   * egress path, where the launcher appends `--info-fd N --` itself.
   */
  terminate?: boolean;
}): string[] {
  // Net flag composes with the FS unshare: keep host net, or take a fresh one.
  const netFlag = net.kind === "namespaced" ? "--unshare-net" : "--share-net";
  const args: string[] = ["bwrap", "--unshare-all", netFlag, "--die-with-parent"];

  // Privilege drop INSIDE the user namespace. `--unshare-all` includes
  // `--unshare-user`, so `--uid`/`--gid` map the child to the dedicated
  // low-priv id. This is the path that ACTUALLY drops privilege (Bun.spawn's
  // uid/gid is silently ignored), so the EffectiveSandbox `enforced.privilege`
  // is only truthful when the wrapper is engaged. Emit gid first so the
  // supplementary-group reset that bwrap performs lands on the right primary.
  if (dropUid !== undefined) {
    if (dropGid !== undefined) {
      args.push("--gid", String(dropGid));
    }
    args.push("--uid", String(dropUid));
  }

  // Filesystem binds FIRST, then `--proc` / `--dev` overlay on top of the
  // confined tree (bwrap applies operations in order, so a later `--proc`
  // correctly mounts over the bound root rather than being hidden by it).
  if (fsConfinement && scratchDir !== undefined) {
    for (const base of RO_BASE_PATHS) {
      if (pathExists(base)) {
        args.push("--ro-bind", base, base);
      }
    }
    if (interpreterBind !== undefined) {
      args.push("--ro-bind", interpreterBind, interpreterBind);
    }
    // Fresh tmpfs at /tmp BEFORE the scratch bind. The per-run scratch dir is
    // commonly created under the host `/tmp` (os.tmpdir()), so mounting the
    // tmpfs first and binding the scratch dir ON TOP of it keeps the scratch
    // bind visible. The reverse order would let the tmpfs MASK the scratch
    // bind, leaving the child with no CWD (`chdir` then fails and the run
    // hangs/breaks). bwrap applies operations in order, so order matters here.
    args.push("--tmpfs", "/tmp", "--bind", scratchDir, scratchDir);
    if (nodeModulesDir !== undefined && pathExists(nodeModulesDir)) {
      args.push("--ro-bind", nodeModulesDir, nodeModulesDir);
    }
    // The standard pseudo-filesystems on top of the confined tree.
    args.push("--proc", "/proc", "--dev", "/dev", "--chdir", scratchDir);
  } else {
    // Network-only confinement: `--unshare-all` also unshares the mount
    // namespace, so without binds the child would see an empty root. Keep the
    // host filesystem fully visible (no FS layer requested) by binding `/`,
    // then overlay fresh /proc and /dev for the new namespaces.
    args.push("--bind", "/", "/", "--proc", "/proc", "--dev", "/dev");
  }

  if (terminate) {
    args.push("--");
  }
  return args;
}

/**
 * Build the nsjail network flags for a decision.
 *
 *  - `host`               → `--disable_clone_newnet` (keep host net).
 *  - `deny` (no iface)    → `--clone_newnet` only: a ROUTELESS namespace,
 *                           loopback only — that is the goal, no filter/uplink.
 *  - `allowlist` (+iface) → `--clone_newnet` + `--macvlan_iface <iface>` to
 *                           plumb REAL egress into the namespace, the
 *                           `--macvlan_vs_ip/_nm/_gw` triple to ADDRESS the
 *                           endpoint so it actually routes (an unaddressed
 *                           macvlan still blackholes), + a final
 *                           `--nftables_file <path>` to filter it. The plumbed +
 *                           ADDRESSED uplink is what makes the allowlist
 *                           reachable rather than a blackhole.
 */
function buildNsjailNetFlags({
  net,
  nftRulesetPath,
}: {
  net: NetworkDecision;
  nftRulesetPath: string | undefined;
}): string[] {
  if (net.kind !== "namespaced") {
    return ["--disable_clone_newnet"];
  }
  const flags: string[] = ["--clone_newnet"];
  // Plumb real egress for a filtered allowlist (never for routeless deny).
  if (net.egressIface !== undefined) {
    flags.push("--macvlan_iface", net.egressIface);
    // Address the endpoint so traffic ROUTES out of the macvlan; without these
    // the macvlan interface is up but has no IP/route and still blackholes. The
    // decision only carries addressing when it was available, and `allowlist` /
    // metadata-block only reach `namespaced` WITH addressing (see network.ts).
    if (net.egressAddressing !== undefined) {
      flags.push(
        "--macvlan_vs_ip",
        net.egressAddressing.ip,
        "--macvlan_vs_nm",
        net.egressAddressing.netmask,
        "--macvlan_vs_gw",
        net.egressAddressing.gateway,
      );
    }
  }
  // Install the egress filter when we have both a ruleset and a place to stage
  // it. (Only meaningful alongside the macvlan uplink above; a deny namespace
  // carries no ruleset.)
  if (net.nftRuleset !== undefined && nftRulesetPath !== undefined) {
    flags.push("--nftables_file", nftRulesetPath);
  }
  return flags;
}

/**
 * Build an `nsjail` argv prelude with the equivalent bind set + network
 * handling (see {@link buildNsjailNetFlags}).
 */
function buildNsjailPrelude({
  fsConfinement,
  scratchDir,
  nodeModulesDir,
  interpreterBind,
  net,
  dropUid,
  dropGid,
  nftRulesetPath,
  pathExists,
}: {
  fsConfinement: boolean;
  scratchDir: string | undefined;
  nodeModulesDir: string | undefined;
  interpreterBind: string | undefined;
  net: NetworkDecision;
  /** Low-priv UID/GID to drop to inside the namespace (`nsjail --user/--group`). */
  dropUid: number | undefined;
  dropGid: number | undefined;
  nftRulesetPath: string | undefined;
  pathExists: (path: string) => boolean;
}): string[] {
  const netFlags = buildNsjailNetFlags({ net, nftRulesetPath });
  const args: string[] = ["nsjail", "--quiet", "--mode", "o", ...netFlags];

  // Privilege drop inside the nsjail user namespace. `--user`/`--group` map the
  // inside-namespace id to the dedicated low-priv id (the path that actually
  // drops; Bun.spawn's uid/gid is ignored).
  if (dropUid !== undefined) {
    args.push("--user", String(dropUid));
    if (dropGid !== undefined) {
      args.push("--group", String(dropGid));
    }
  }

  if (fsConfinement && scratchDir !== undefined) {
    for (const base of RO_BASE_PATHS) {
      if (pathExists(base)) {
        args.push("--bindmount_ro", `${base}:${base}`);
      }
    }
    if (interpreterBind !== undefined) {
      args.push("--bindmount_ro", `${interpreterBind}:${interpreterBind}`);
    }
    args.push("--bindmount", `${scratchDir}:${scratchDir}`);
    if (nodeModulesDir !== undefined && pathExists(nodeModulesDir)) {
      args.push("--bindmount_ro", `${nodeModulesDir}:${nodeModulesDir}`);
    }
    args.push("--cwd", scratchDir);
  } else {
    // Network-only confinement: keep the host filesystem visible (no FS layer
    // requested) by binding the host root, so ordinary binaries still resolve.
    args.push("--bindmount", "/:/");
  }

  args.push("--");
  return args;
}

/**
 * Resolve the combined filesystem + network namespace layer for a run into
 * either an argv prelude (enforced) or a degrade reason. Pure & synchronous;
 * the only side-channels are the injectable `pathExists` / `realpath` probes
 * (default to the real `node:fs` calls) so tests can drive them without
 * touching disk.
 *
 * The `network` decision (resolved upstream by `buildNetworkLayer`) is folded
 * into the SAME wrapper invocation so FS and net compose rather than fight. A
 * run that confines only the network (FS `off` but `network` namespaced) still
 * produces a wrapper prelude.
 *
 * @returns `off` when neither FS nor network needs a wrapper; `enforced` with
 *   the wrapper prelude when one is needed AND deliverable; `degrade` (with a
 *   reason) when FS confinement was requested but cannot be delivered. The
 *   network degrade decision is resolved before this is called and handled by
 *   the caller; here a `network.kind === "host"` simply keeps host net.
 */
export function buildFilesystemLayer({
  policy,
  caps,
  inputs,
  network,
  nftRulesetPath,
  pathExists = existsSyncDefault,
  realpath = realpathDefault,
}: {
  policy: FilesystemPolicy;
  caps: SandboxCapabilities;
  inputs: FilesystemRunInputs;
  /**
   * The resolved network decision to compose into the wrapper. When omitted,
   * the host net is kept (the pre-Phase-3 behavior).
   */
  network?: NetworkDecision;
  /**
   * Path to a file holding the nftables ruleset (written by the runner) for
   * `nsjail --nftables_file`. Required only when `network.nftRuleset` is set.
   */
  nftRulesetPath?: string;
  pathExists?: (path: string) => boolean;
  realpath?: (path: string) => string;
}): FilesystemBuildResult {
  const net: NetworkDecision = network ?? {
    kind: "host",
    metadataBlockUnenforceable: false,
  };
  const wantsFsConfinement = policy.mode !== "off";
  const wantsNetNamespace = net.kind === "namespaced";

  // Nothing needs a wrapper: FS off AND net stays on the host.
  if (!wantsFsConfinement && !wantsNetNamespace) {
    return { kind: "off" };
  }

  // A wrapper is needed (for FS confinement and/or a net namespace). Gate on
  // wrapper capability. FS-specific degrade reasons are only relevant when FS
  // confinement was actually requested; otherwise this is a network-only
  // wrapper and the network degrade was already resolved upstream — but we
  // still need the same primitives, so guard them here too.
  if (caps.platform !== "linux") {
    return {
      kind: "degrade",
      reason: `${wantsFsConfinement ? "filesystem" : "network"} isolation requires Linux namespaces (platform=${caps.platform}); running with full host FS/net`,
    };
  }
  if (!caps.userNamespaces) {
    return {
      kind: "degrade",
      reason:
        "namespace isolation requires unprivileged user namespaces, which are disabled on this host; running with full host FS/net",
    };
  }
  if (caps.wrapper === null) {
    return {
      kind: "degrade",
      reason:
        "namespace isolation requires a wrapper (bwrap/nsjail), none found on PATH; running with full host FS/net",
    };
  }
  if (caps.wrapper === "firejail") {
    return {
      kind: "degrade",
      reason:
        "namespace isolation via firejail is not supported (profile model); install bwrap or nsjail; running with full host FS/net",
    };
  }
  if (wantsFsConfinement && inputs.scratchDir === undefined) {
    return {
      kind: "degrade",
      reason:
        "filesystem isolation needs a per-run scratch dir, none was provided by this runner; running with full host FS",
    };
  }

  const interpreterBind = resolveInterpreterBind({
    interpreterPath: inputs.interpreterPath,
    pathExists,
    realpath,
  });

  const nodeModulesDir =
    policy.mode === "scratch-plus-ro" ? inputs.nodeModulesDir : undefined;

  // The ROOTLESS egress path is bwrap-only and cannot be a plain argv prelude:
  // slirp4netns is orchestrated from the parent netns via a launcher. Build the
  // bwrap argv WITHOUT the trailing `--` and hand it to the caller, which folds
  // it into the launcher script (see rootless-egress.ts). `--unshare-net` is
  // already in the bwrap argv (the `namespaced` decision selects it below), so
  // bwrap takes the fresh net namespace slirp4netns then plumbs into.
  if (net.kind === "namespaced" && net.egressPath === "rootless") {
    // The rootless path is only reachable when caps.wrapper === "bwrap" (see
    // capabilities.ts: netEgressRootless gates on bwrap). Guard defensively.
    if (caps.wrapper !== "bwrap") {
      return {
        kind: "degrade",
        reason:
          "rootless egress (slirp4netns) is delivered only via bwrap; this host's wrapper cannot orchestrate it; egress unrestricted",
      };
    }
    const bwrapArgv = buildBwrapPrelude({
      fsConfinement: wantsFsConfinement,
      scratchDir: inputs.scratchDir,
      nodeModulesDir,
      interpreterBind,
      net,
      dropUid: inputs.dropUid,
      dropGid: inputs.dropGid,
      pathExists,
      terminate: false,
    });
    return { kind: "enforced-rootless-egress", bwrapArgv };
  }

  const prelude =
    caps.wrapper === "bwrap"
      ? buildBwrapPrelude({
          fsConfinement: wantsFsConfinement,
          scratchDir: inputs.scratchDir,
          nodeModulesDir,
          interpreterBind,
          net,
          dropUid: inputs.dropUid,
          dropGid: inputs.dropGid,
          pathExists,
        })
      : buildNsjailPrelude({
          fsConfinement: wantsFsConfinement,
          scratchDir: inputs.scratchDir,
          nodeModulesDir,
          interpreterBind,
          net,
          dropUid: inputs.dropUid,
          dropGid: inputs.dropGid,
          nftRulesetPath,
          pathExists,
        });

  return { kind: "enforced", prelude };
}

/** Default on-disk probe. Tests inject a fake to stay off the filesystem. */
function existsSyncDefault(path: string): boolean {
  return existsSync(path);
}

/** Default realpath resolver. Tests inject a fake to stay off the filesystem. */
function realpathDefault(path: string): string {
  return realpathSync(path);
}
