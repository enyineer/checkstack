import type { SandboxCapabilities } from "./capabilities";
import { buildSubprocessEnv } from "./env-guard";
import {
  buildFilesystemLayer,
  type FilesystemRunInputs,
} from "./filesystem";
import { buildNetworkLayer, type NetworkDecision } from "./network";
import type { SandboxPolicy } from "./policy";
import { buildRootlessLauncherScript } from "./rootless-egress";
import {
  type EffectiveSandbox,
  type EnforcedLayers,
  type SandboxDowngrade,
  type SandboxNote,
  SandboxUnavailableError,
} from "./report";

/**
 * Translates a validated {@link SandboxPolicy} + detected
 * {@link SandboxCapabilities} into the concrete extra `Bun.spawn` options the
 * two runners apply, plus an {@link EffectiveSandbox} report of what was
 * actually enforced vs. degraded.
 *
 * Enforced so far:
 *  - resource caps via a `prlimit` argv prelude (Linux + util-linux), with
 *    `maxOutputBytes` surfaced for runner-side truncation (portable);
 *  - privilege drop via `uid`/`gid` (when euid is root);
 *  - the env denylist (via {@link buildSubprocessEnv});
 *  - filesystem isolation via a namespace wrapper (`bwrap`/`nsjail`) when one
 *    is present and the runner supplies a scratch dir (Phase 2, see
 *    {@link buildFilesystemLayer}); otherwise the layer degrades (or fails per
 *    `onUnavailable`) and the gap is surfaced;
 *  - network egress control (Phase 3): a fresh net namespace for `deny` /
 *    `allowlist` (and the always-on metadata/link-local block under
 *    `unrestricted`), COMPOSED into the SAME wrapper invocation as the FS layer
 *    so the two never fight over the net namespace — when network confinement
 *    is on the wrapper takes a fresh net namespace instead of `--share-net`,
 *    and for `allowlist` an nftables egress filter is installed (nsjail).
 */

export interface BuildSpawnHardeningInput {
  policy: SandboxPolicy;
  caps: SandboxCapabilities;
  /**
   * Base env (typically `pickSafeEnv()`); the curated safe vars that are
   * always forwarded.
   */
  baseEnv: Record<string, string>;
  /** Caller-supplied env overrides (secret env, scope env, operator env). */
  envOverrides?: Record<string, string>;
  /**
   * Per-run filesystem inputs (the ESM runner's scratch dir + the reconciled
   * node_modules tree + the interpreter path to bind). Omit for runners with no
   * per-run scratch dir (e.g. the shell runner): the filesystem layer then
   * degrades when requested, but a network-only namespace is still built.
   */
  filesystem?: FilesystemRunInputs;
  /**
   * Path at which the runner WILL write the nftables egress ruleset (for the
   * network allowlist / metadata-block filter installed via
   * `nsjail --nftables_file`). The runner reads back {@link SpawnHardening.nftRuleset}
   * and writes it here before spawn. Omit on runners that cannot stage a file
   * (the network filter then degrades).
   */
  nftRulesetPath?: string;
  /**
   * Path at which the runner WILL write the ROOTLESS egress launcher script
   * (see {@link SpawnHardening.rootlessLauncher}). When the resolved network
   * decision picks the rootless slirp4netns path, the prelude becomes
   * `["sh", rootlessLauncherPath]`; the runner stages the script here (and the
   * nft ruleset at {@link nftRulesetPath}) before spawn. Omit on runners that
   * cannot stage a file — the rootless path then degrades-and-surfaces (host
   * net), never a blackhole.
   */
  rootlessLauncherPath?: string;
  /**
   * Whether THIS runner actually applies the JS-heap memory cap
   * (`NODE_OPTIONS=--max-old-space-size`) to the spawned child. The ESM runner
   * execs a Node/Bun interpreter that honours it, so it passes `true`. The
   * SHELL runner execs `sh -c`, which ignores `NODE_OPTIONS`, so it passes
   * `false` (or omits it): for shell scripts there is NO per-run memory
   * enforcement and the ceiling is purely the container cgroup. When a
   * `memoryBytes` cap is requested but this runner cannot apply the heap cap,
   * the gap is surfaced as a NON-FATAL note (never a downgrade, so it never
   * fail-closes) — see {@link SandboxNote}. Defaults to `false` (the
   * conservative, honest assumption: do not imply a guarantee a runner may not
   * provide).
   */
  appliesNodeMemoryCap?: boolean;
}

export interface SpawnHardening {
  /** Wrap the real command argv with any rlimit prelude. */
  wrapCmd(cmd: string[]): string[];
  /** Final subprocess env (safe base + overrides, denylist applied). */
  env: Record<string, string>;
  /** Env keys dropped by the denylist (for surfacing). */
  droppedEnvKeys: string[];
  /**
   * The privilege-drop UID/GID, for OBSERVABILITY only. These are NEVER passed
   * to `Bun.spawn` (its uid/gid is a silent no-op today, and a forward-compat
   * hazard if Bun starts honouring it: it would spawn the namespace wrapper
   * ITSELF as the dropped id and break userns creation). The actual drop is
   * delivered by the wrapper's `--uid`/`--gid` (root supervisor) or by
   * inheritance from a non-root supervisor. Present only on the genuine
   * root-supervisor wrapper-drop path; undefined otherwise.
   */
  uid?: number;
  gid?: number;
  /**
   * Hard cap on captured stdout+stderr bytes, or undefined for no cap. The
   * runner enforces this purely in JS (portable across platforms).
   */
  maxOutputBytes?: number;
  /** Extra env to merge for the ESM runner's portable memory fallback. */
  nodeMemoryFlagEnv?: Record<string, string>;
  /**
   * The nftables egress ruleset the runner must write to `nftRulesetPath`
   * before spawn (consumed by `nsjail --nftables_file`). Undefined when no
   * filter is needed (FS-only, host net, or pure `deny`).
   */
  nftRuleset?: string;
  /**
   * The ROOTLESS egress launcher script the runner must write to
   * `rootlessLauncherPath` before spawn (then the prelude execs it as
   * `sh <path>`). Undefined unless the network decision picked the rootless
   * slirp4netns path AND it could be staged. The launcher orchestrates
   * slirp4netns + the fail-closed nftables filter; see `rootless-egress.ts`.
   */
  rootlessLauncher?: string;
  /** What was actually enforced / degraded. */
  effective: EffectiveSandbox;
}

/**
 * Build the `prlimit` argv prelude for the requested resource caps.
 *
 * `nprocIsolated` controls whether `--nproc` (RLIMIT_NPROC) is emitted, the
 * fork-bomb cap. RLIMIT_NPROC is enforced PER (UID, user-namespace): the kernel
 * counts a process against its real UID *within its user namespace*. So the cap
 * genuinely isolates a single run's process count from the supervisor (and from
 * sibling runs) IN EITHER of two ways:
 *
 *  1. The run executes inside a WRAPPER-CREATED USER NAMESPACE (the shipped
 *     non-root model: rootless `bwrap --unshare-all`, which always creates a
 *     fresh user namespace). Even though the child shares the supervisor's host
 *     UID (65532), the fresh user namespace means its RLIMIT_NPROC count starts
 *     from zero relative to that namespace, so the bomb is capped WITHOUT
 *     throttling the supervisor or sibling runs in other namespaces. (Verified
 *     in-container: a fork bomb under `bwrap --unshare-all` + `prlimit
 *     --nproc=N` is capped at N while the supervisor — same UID 65532, parent
 *     namespace — keeps forking freely.) The fresh PID namespace that
 *     `--unshare-all` also creates means a single kill of the wrapper reaps the
 *     whole tree.
 *  2. The run dropped to a DEDICATED low-priv UID via the namespace wrapper's
 *     `--uid` (the legacy ROOT-supervisor path): a distinct UID is isolated by
 *     construction.
 *
 * It is NOT safe (and so omitted) when the run executes WITHOUT a wrapper
 * namespace under the supervisor's own UID — there the cap would count EVERY
 * process owned by that UID, including the supervisor and sibling runs, so a low
 * `maxProcesses` could starve the host of fork capacity. All other rlimits
 * (`--cpu`, `--nofile`, `--fsize`) are per-process and always safe.
 */
function buildPrlimitPrelude({
  policy,
  nprocIsolated,
}: {
  policy: SandboxPolicy;
  nprocIsolated: boolean;
}): string[] {
  const { resources } = policy;
  const args: string[] = [];
  if (resources.cpuSeconds !== undefined) {
    args.push(`--cpu=${resources.cpuSeconds}`);
  }
  // NOTE: `memoryBytes` is deliberately NOT mapped to `prlimit --as`
  // (RLIMIT_ADDRESS_SPACE). RLIMIT_AS caps the VIRTUAL address space, not the
  // resident set, and modern runtimes (Bun, Node, the JVM) RESERVE tens of GiB
  // of virtual space at startup, so a `--as` equal to the intended RSS makes the
  // interpreter SIGABRT immediately (verified: `bun` aborts under `--as=512MB`).
  // RLIMIT_DATA has the same problem; RLIMIT_RSS is unenforced on current
  // kernels. The correct hard memory cap is a CGROUP limit (Docker `--memory` /
  // a Kubernetes resources.limits.memory), which the deployment supplies. We
  // therefore enforce memory via (a) the ESM heap cap
  // `NODE_OPTIONS=--max-old-space-size` (a real JS-heap limit, always applied
  // below) and (b) the cgroup limit from the runtime - never a broken `--as`.
  if (resources.maxOpenFiles !== undefined) {
    args.push(`--nofile=${resources.maxOpenFiles}`);
  }
  if (resources.maxProcesses !== undefined && nprocIsolated) {
    args.push(`--nproc=${resources.maxProcesses}`);
  }
  if (resources.maxFileSizeBytes !== undefined) {
    args.push(`--fsize=${resources.maxFileSizeBytes}`);
  }
  if (args.length === 0) {
    return [];
  }
  return ["prlimit", ...args, "--"];
}

/** True when the resource policy requests any rlimit-backed cap. */
function requestsRlimitCaps(policy: SandboxPolicy): boolean {
  const { resources } = policy;
  return (
    resources.cpuSeconds !== undefined ||
    resources.memoryBytes !== undefined ||
    resources.maxOpenFiles !== undefined ||
    resources.maxProcesses !== undefined ||
    resources.maxFileSizeBytes !== undefined
  );
}

/**
 * Build the OS-level hardening for a single run. Pure & synchronous
 * (capability detection is cached upstream), so neither runner gains an
 * `await` before spawn.
 *
 * @throws {SandboxUnavailableError} when a requested layer cannot be enforced
 *   and `policy.onUnavailable === "fail"`. The runner catches this and returns
 *   a clean failure WITHOUT spawning an unsandboxed child.
 */
export function buildSpawnHardening({
  policy,
  caps,
  baseEnv,
  envOverrides,
  filesystem,
  nftRulesetPath,
  rootlessLauncherPath,
  appliesNodeMemoryCap,
}: BuildSpawnHardeningInput): SpawnHardening {
  const downgrades: SandboxDowngrade[] = [];
  const notes: SandboxNote[] = [];
  const enforced: EnforcedLayers = {
    resources: false,
    filesystem: false,
    network: false,
    privilege: false,
  };

  // When the sandbox is disabled, behave exactly as before: full safe-env
  // merge with NO denylist, no caps, no uid/gid, no truncation.
  if (!policy.enabled) {
    const { env } = buildSubprocessEnv({
      base: baseEnv,
      overrides: envOverrides,
      applyDenylist: false,
    });
    return {
      wrapCmd: (cmd) => cmd,
      env,
      droppedEnvKeys: [],
      effective: {
        requested: policy,
        enforced,
        downgrades: [],
        notes: [],
        platform: caps.platform,
      },
    };
  }

  // --- Env (denylist applied when enabled) -------------------------------
  const { env, dropped: droppedEnvKeys } = buildSubprocessEnv({
    base: baseEnv,
    overrides: envOverrides,
    applyDenylist: true,
  });

  // --- Layer: privilege (resolved FIRST) ---------------------------------
  // Decided before resources because RLIMIT_NPROC is per-UID and is only safe
  // when the child is genuinely a low-priv id (see buildPrlimitPrelude).
  //
  // TWO supervisor models, both supported:
  //
  //  1. NON-ROOT supervisor (the SHIPPED images: uid 65532). The child INHERITS
  //     the supervisor's non-root uid by construction, so it can NEVER be
  //     host-root - the "script is not root" requirement is satisfied by
  //     inheritance, regardless of whether a wrapper is engaged. A `drop-to-uid`
  //     to a DIFFERENT id is generally impossible rootless (no subuid/newuidmap)
  //     and is NOT needed, so we do NOT carry a wrapper `--uid` flag here. Under
  //     rootless bwrap (`--unshare-user`) in-namespace root maps back to this
  //     same unprivileged host uid, so even mapped-root cannot escape to host
  //     root. `enforced.privilege` is therefore TRUE.
  //
  //  2. ROOT supervisor (legacy / some deployments: euid 0). The drop MUST be
  //     performed by the NAMESPACE WRAPPER (`bwrap --uid` / `nsjail --user`),
  //     NOT by `Bun.spawn`'s uid/gid (Bun silently ignores those - the child
  //     stays root). So a `drop-to-uid` only actually drops when the wrapper is
  //     engaged; the `enforced.privilege` verdict is deferred until after the FS
  //     layer resolves (see `privilegeDropWanted` + the verdict block below).
  //
  // INVARIANT: `enforced.privilege` is true ONLY when the child cannot run as
  // host-root. It is NEVER true on a path where the script could be host-root
  // (root supervisor + no wrapper carrying the drop).
  let uid: number | undefined;
  let gid: number | undefined;
  // Whether the ROOT-supervisor wrapper drop is wanted (only meaningful when
  // euid is root). For a non-root supervisor this stays false: there is nothing
  // to drop and nothing for the wrapper to carry.
  let privilegeDropWanted = false;
  if (policy.privilege.mode === "drop-to-uid") {
    if (caps.euidIsRoot) {
      if (policy.privilege.uid === undefined) {
        downgrades.push({
          layer: "privilege",
          reason:
            "drop-to-uid requested but no target uid configured and the supervisor euid is root: the child would run as host-root",
        });
      } else {
        // Root supervisor: the wrapper must carry the `--uid` drop. Verdict gated
        // below on the wrapper actually being engaged.
        uid = policy.privilege.uid;
        gid = policy.privilege.gid;
        privilegeDropWanted = true;
      }
    } else {
      // Non-root supervisor: the child inherits non-root and cannot be
      // host-root. Enforced by construction; no wrapper `--uid`, no spawn
      // uid/gid, no downgrade. (A configured target uid is irrelevant rootless;
      // we never attempt a different-id map.)
      enforced.privilege = true;
    }
  } else if (caps.euidIsRoot) {
    // inherit under a ROOT supervisor leaves the child as host-root, which is
    // NOT a privilege-enforced state.
    downgrades.push({
      layer: "privilege",
      reason:
        "privilege inherit under a ROOT supervisor leaves the child running as host-root; run the supervisor as a non-root uid, or use drop-to-uid with a wrapper engaged",
    });
  } else {
    // inherit under a NON-root supervisor: the child inherits non-root and
    // cannot be host-root. Enforced by construction.
    enforced.privilege = true;
  }
  // RLIMIT_NPROC is per-UID, so it is only safe when the child runs under a uid
  // ISOLATED from the host supervisor's uid. That holds ONLY on the
  // root-supervisor path where the wrapper maps the child to a DEDICATED
  // low-priv id via `--uid` (recomputed in the verdict block). It does NOT hold
  // for the non-root supervisor: there the child INHERITS the supervisor's own
  // uid (65532), so an `--nproc` cap would also throttle the supervisor and its
  // sibling runs - the exact starvation the guard prevents. So this stays false
  // here and is only flipped true on the root-wrapper-drop path below.
  let dropsPrivilege = false;

  // --- Layer: resources --------------------------------------------------
  // The `prlimit` prelude itself is built AFTER the FS layer below, because
  // RLIMIT_NPROC may only be applied once the privilege drop is genuinely in
  // effect, and the drop is delivered by the wrapper (resolved below). Here we
  // only decide `enforced.resources` and whether prlimit is available.
  let rlimitPrelude: string[] = [];
  const wantsRlimit = requestsRlimitCaps(policy);
  if (wantsRlimit) {
    if (caps.rlimitNative) {
      enforced.resources = true;
    } else {
      downgrades.push({
        layer: "resources",
        reason:
          "rlimit caps not enforceable (no prlimit on this host); " +
          "falling back to wall-clock timeout + output truncation" +
          (caps.platform === "linux" ? "" : ` (platform=${caps.platform})`),
      });
      // maxOutputBytes (below) is still enforced — that is the portable subset.
    }
  } else if (policy.resources.maxOutputBytes !== undefined) {
    // No rlimit caps requested but an output cap is — that is fully portable.
    enforced.resources = true;
  }

  // --- ESM memory cap (the JS-heap limit) --------------------------------
  // Memory is enforced via the JS heap cap `NODE_OPTIONS=--max-old-space-size`
  // (a REAL heap limit the runtime honours) rather than `prlimit --as` (which
  // breaks the interpreter - see buildPrlimitPrelude). Applied whenever a memory
  // cap is requested, on every host (it is portable and does not depend on any
  // namespace primitive). The shell runner ignores this env; for shell scripts
  // the hard memory ceiling is the cgroup limit from the container runtime.
  let nodeMemoryFlagEnv: Record<string, string> | undefined;
  if (policy.resources.memoryBytes !== undefined) {
    const megabytes = Math.max(
      16,
      Math.floor(policy.resources.memoryBytes / (1024 * 1024)),
    );
    // Intentionally NOT subject to the env denylist (we set it ourselves; it
    // is a controlled cap, not a caller-supplied override).
    nodeMemoryFlagEnv = {
      NODE_OPTIONS: `--max-old-space-size=${megabytes}`,
    };
    // SHELL MEMORY HONESTY (review MAJOR): the heap cap is only applied by a
    // runner that execs a Node/Bun interpreter (`appliesNodeMemoryCap`). The
    // SHELL runner execs `sh -c`, which IGNORES `NODE_OPTIONS`, so a shell run
    // has NO per-run memory enforcement - its only ceiling is the container
    // cgroup. That is a legitimate ceiling, not a missing layer: refusing every
    // shell run under fail-closed would break all shell health-checks and
    // automation. So we surface it as a NON-FATAL note (never a downgrade, so
    // it never trips `onUnavailable: "fail"`), and `enforced.resources` is NOT
    // taken to imply a per-run memory guarantee for shell.
    if (appliesNodeMemoryCap !== true) {
      notes.push({
        layer: "resources",
        note:
          "per-run memory (memoryBytes) is NOT enforced for this run: the " +
          "NODE_OPTIONS=--max-old-space-size heap cap is honoured only by the " +
          "ESM/Node interpreter, not by `sh -c`. The hard memory ceiling for " +
          "shell scripts is the container cgroup limit (Docker --memory / " +
          "Kubernetes resources.limits.memory), which the deployment supplies.",
      });
    }
  }

  // --- Layer: network (Phase 3) — resolved FIRST so it composes into the FS
  // wrapper invocation (FS + net share ONE bwrap/nsjail call). The decision is
  // also what tells the FS layer whether to keep `--share-net` or take a fresh
  // net namespace.
  const networkDecision = buildNetworkLayer({ policy: policy.network, caps });
  let nftRuleset: string | undefined;
  // The rootless slirp4netns path additionally needs a launcher-script staging
  // path (the orchestration cannot be a plain argv prelude). Track whether the
  // chosen decision is rootless AND fully stageable.
  const wantsRootlessEgress =
    networkDecision.kind === "namespaced" &&
    networkDecision.egressPath === "rootless";
  const rootlessStageable =
    wantsRootlessEgress &&
    nftRulesetPath !== undefined &&
    rootlessLauncherPath !== undefined;
  if (networkDecision.kind === "host") {
    if (networkDecision.metadataBlockUnenforceable) {
      downgrades.push({
        layer: "network",
        reason:
          "metadata/link-local egress block requested but not enforceable on this host: it needs a net namespace WITH real egress plumbed in (privileged macvlan: nsjail + CAP_NET_ADMIN + a usable host interface; or rootless: bwrap + an unprivileged user+net namespace + slirp4netns) so ordinary traffic still flows; a routeless namespace would sever ALL egress, so host net is kept; egress unrestricted (metadata NOT blocked)",
      });
    } else {
      enforced.network = true;
    }
  } else if (networkDecision.kind === "namespaced") {
    // Confinement is deliverable IF the FS layer below actually builds the
    // wrapper (same primitives). A pure-deny netns needs no ruleset; an
    // allowlist / metadata-block ruleset is staged by the runner.
    nftRuleset = networkDecision.nftRuleset;
    if (nftRuleset !== undefined && nftRulesetPath === undefined) {
      // The filter could not be staged (runner can't write a ruleset file):
      // refuse to silently run without it.
      downgrades.push({
        layer: "network",
        reason:
          "network egress filter could not be staged (no ruleset file path available from this runner); egress unrestricted",
      });
    } else if (wantsRootlessEgress && !rootlessStageable) {
      // The rootless launcher script could not be staged by this runner.
      // Degrade rather than take a routeless namespace (which would blackhole).
      downgrades.push({
        layer: "network",
        reason:
          "rootless egress (slirp4netns) requires staging a launcher script, but this runner provided no launcher path; egress unrestricted",
      });
    } else {
      enforced.network = true;
    }
  } else {
    downgrades.push({ layer: "network", reason: networkDecision.reason });
  }
  // If the network filter / launcher could not be staged, fall back to keeping
  // host net in the wrapper (so we don't take a netns we can't filter and
  // accidentally cut off all egress under what the operator asked to be an
  // allowlist).
  const netUnstageable =
    networkDecision.kind === "namespaced" &&
    ((networkDecision.nftRuleset !== undefined && nftRulesetPath === undefined) ||
      (wantsRootlessEgress && !rootlessStageable));
  const effectiveNetDecision: NetworkDecision = netUnstageable
    ? { kind: "host", metadataBlockUnenforceable: false }
    : networkDecision;

  // --- Layer: filesystem (Phase 2) — composed with the network decision ---
  let fsPrelude: string[] = [];
  // For the ROOTLESS egress path the prelude is a generated launcher script
  // (slirp4netns + the fail-closed nft filter) that wraps the bwrap argv. The
  // launcher is staged by the runner; here we only build the script text and
  // the `sh <launcher> -- <inner cmd>` invocation in `wrapCmd`.
  let rootlessLauncher: string | undefined;
  const fsLayer = buildFilesystemLayer({
    policy: policy.filesystem,
    caps,
    // Thread the resolved privilege drop target into the wrapper so it can
    // carry `--uid`/`--gid` (the ONLY mechanism that actually drops; Bun.spawn's
    // uid/gid is ignored). `uid`/`gid` are undefined unless a drop was resolved.
    inputs: { ...filesystem, dropUid: uid, dropGid: gid },
    network: effectiveNetDecision,
    nftRulesetPath,
  });
  switch (fsLayer.kind) {
    case "off": {
      enforced.filesystem = true; // "off" is trivially "enforced as requested".
      break;
    }
    case "enforced": {
      fsPrelude = fsLayer.prelude;
      enforced.filesystem = true;
      break;
    }
    case "enforced-rootless-egress": {
      // FS confinement (if requested) is delivered by the SAME bwrap argv the
      // launcher wraps, so it is enforced here too. The launcher text embeds
      // the bwrap argv + the nft ruleset path; the real command is appended at
      // `wrapCmd` time as the launcher's positional args.
      enforced.filesystem = true;
      if (nftRulesetPath !== undefined && rootlessLauncherPath !== undefined) {
        rootlessLauncher = buildRootlessLauncherScript({
          bwrapArgv: fsLayer.bwrapArgv,
          nftRulesetPath,
        });
      } else {
        // Should not happen: effectiveNetDecision is only rootless when
        // rootlessStageable. Defensive — degrade the network layer if it does.
        enforced.network = false;
        nftRuleset = undefined;
        downgrades.push({
          layer: "network",
          reason:
            "rootless egress launcher could not be staged (missing ruleset/launcher path); egress unrestricted",
        });
      }
      break;
    }
    case "degrade": {
      // The wrapper could not be built. If FS confinement was requested this is
      // a filesystem downgrade; either way a requested net namespace also
      // cannot be delivered (same primitives), so reconcile the network state.
      if (policy.filesystem.mode !== "off") {
        downgrades.push({ layer: "filesystem", reason: fsLayer.reason });
      }
      if (effectiveNetDecision.kind === "namespaced") {
        enforced.network = false;
        downgrades.push({
          layer: "network",
          reason: `network egress namespace could not be delivered: ${fsLayer.reason}`,
        });
        nftRuleset = undefined;
      }
      break;
    }
  }

  // --- Privilege verdict (root-supervisor path only) ---------------------
  // Only relevant when the supervisor euid is root and a `drop-to-uid` target
  // was configured (`privilegeDropWanted`). The wrapper carries the
  // `--uid`/`--gid` drop only when it was actually built: `enforced` (plain
  // prelude) or `enforced-rootless-egress` with a staged launcher. A
  // `drop-to-uid` with NO wrapper engaged cannot drop (Bun's spawn uid/gid is a
  // silent no-op), so the child would run as host-root: NOT enforced, surfaced.
  // (The non-root supervisor path already set `enforced.privilege = true` by
  // inheritance above and left `uid`/`gid` unset, so it falls through here.)
  const wrapperCarriesDrop =
    fsLayer.kind === "enforced" ||
    (fsLayer.kind === "enforced-rootless-egress" && rootlessLauncher !== undefined);
  if (privilegeDropWanted) {
    if (wrapperCarriesDrop) {
      enforced.privilege = true;
      dropsPrivilege = true;
    } else {
      // The wrapper is not engaged, so the drop cannot happen and the child
      // would run as host-root. Clear the observability uid/gid (there is no
      // real drop to report) and surface the gap.
      uid = undefined;
      gid = undefined;
      downgrades.push({
        layer: "privilege",
        reason:
          "privilege drop-to-uid could not be enforced: it is performed by the " +
          "namespace wrapper (bwrap/nsjail), which is not engaged for this run " +
          "(no filesystem confinement and no network namespace), and Bun's spawn " +
          "uid/gid is silently ignored; the child would run as host-root. Run " +
          "the supervisor as a non-root uid (the shipped images do) so the child " +
          "inherits non-root regardless of the wrapper",
      });
    }
  }

  // --- Resource prelude (built now that the drop + wrapper verdict is known) --
  // RLIMIT_NPROC (the fork-bomb cap) is per (UID, user-namespace), so it is
  // applied whenever the run is `nprocIsolated`: it executes inside a
  // WRAPPER-CREATED USER NAMESPACE (rootless `bwrap --unshare-all`, the shipped
  // model — the fresh user namespace makes the cap count only THIS run, even
  // under the shared supervisor uid) OR it dropped to a dedicated uid via the
  // root-supervisor wrapper `--uid`. Outside a wrapper namespace it would count
  // the supervisor's processes too, so it is omitted there. Other rlimits
  // (`--cpu`, `--nofile`, `--fsize`) are per-process and always safe.
  //
  // The wrapper engages a user namespace exactly when the FS/net layer built a
  // prelude (`enforced`) or the rootless-egress launcher (`enforced-rootless-
  // egress`). Both `bwrap --unshare-all` and `nsjail` create the user (and PID)
  // namespace, so the cap isolates the run and a single kill of the wrapper
  // reaps the whole fork tree.
  const runsInWrapperUserns =
    fsLayer.kind === "enforced" ||
    (fsLayer.kind === "enforced-rootless-egress" && rootlessLauncher !== undefined);
  const nprocIsolated = dropsPrivilege || runsInWrapperUserns;
  if (wantsRlimit && caps.rlimitNative) {
    rlimitPrelude = buildPrlimitPrelude({ policy, nprocIsolated });
    if (policy.resources.maxProcesses !== undefined && !nprocIsolated) {
      if (caps.euidIsRoot) {
        // ROOT supervisor with no wrapper namespace and no in-effect drop: a
        // real gap (the limit could have isolated a dedicated uid had the
        // wrapper carried the drop).
        downgrades.push({
          layer: "resources",
          reason:
            "maxProcesses (RLIMIT_NPROC) not applied: no namespace wrapper is " +
            "engaged (no filesystem confinement and no network namespace) to " +
            "isolate the process count, and the limit is per-UID so it would also " +
            "throttle the host process; set privilege.mode=drop-to-uid and/or " +
            "enable a wrapper layer to enforce it",
        });
      } else {
        // NON-ROOT supervisor with NO wrapper namespace (FS off AND host net):
        // the child shares the supervisor's uid (65532) in the SAME user
        // namespace, so an `--nproc` cap would also throttle the supervisor and
        // its sibling runs. It is therefore NOT applied per-run on this
        // wrapper-less path; the fork-bomb ceiling is the container cgroup
        // `pids` controller. This is an accepted, expected characteristic of an
        // unwrapped run - NOT a failure to enforce the policy - so it is a
        // NON-FATAL note (never a downgrade, so the fail-closed default still
        // runs). NOTE: under the shipped secure default a wrapper IS engaged
        // (scratch-plus-ro filesystem), so this branch is the unwrapped-FS-off
        // corner case, not the default path - the default path applies the cap
        // via `runsInWrapperUserns`.
        notes.push({
          layer: "resources",
          note:
            "maxProcesses (RLIMIT_NPROC) is NOT applied for this run: no " +
            "namespace wrapper is engaged (filesystem confinement is off and the " +
            "network stays on the host), so the child shares the supervisor's uid " +
            "and user namespace and a per-UID nproc cap would also throttle the " +
            "supervisor. With the shipped secure default (scratch-plus-ro " +
            "filesystem) the wrapper IS engaged and the cap is applied per-run. " +
            "Either way the cgroup pids limit (Docker --pids-limit / Kubernetes) " +
            "remains a backstop the deployment supplies.",
        });
      }
    }
  }

  // --- TMPDIR override under FS confinement ------------------------------
  // FS confinement mounts a FRESH tmpfs at /tmp, but the forwarded host TMPDIR
  // may point outside it (so `$TMPDIR`-based mktemp would fail inside the
  // namespace). When the FS wrapper is actually enforced, pin TMPDIR to the
  // in-namespace tmpfs so temp-file creation works.
  let tmpdirOverrideEnv: Record<string, string> | undefined;
  if (
    (fsLayer.kind === "enforced" ||
      (fsLayer.kind === "enforced-rootless-egress" &&
        rootlessLauncher !== undefined)) &&
    policy.filesystem.mode !== "off"
  ) {
    tmpdirOverrideEnv = { TMPDIR: "/tmp" };
  }

  // --- Fail-closed handling ----------------------------------------------
  if (policy.onUnavailable === "fail" && downgrades.length > 0) {
    throw new SandboxUnavailableError(downgrades);
  }

  // Compose preludes outer-to-inner: the FS/net wrapper (bwrap/nsjail) sets up
  // the namespaces FIRST, then `prlimit` applies the rlimits INSIDE that
  // namespace, then the real command. Each prelude terminates with its own `--`.
  const captureCmdPrelude = [...fsPrelude, ...rlimitPrelude];

  // The TMPDIR override is sandbox-set (not a caller override), so it is folded
  // in here rather than going through the denylist. It only applies when the
  // in-namespace tmpfs is actually present.
  const finalEnv =
    tmpdirOverrideEnv === undefined ? env : { ...env, ...tmpdirOverrideEnv };

  // For the rootless egress path, the prelude is the staged launcher script.
  // The launcher wraps bwrap; the rlimit prelude + real command are appended as
  // the launcher's positional args (forwarded verbatim into the namespace and
  // exec'd after slirp4netns + the nft filter are up). `wrapCmd` therefore
  // produces `sh <launcher> <rlimit-prelude...> <cmd...>`.
  const launcherPath: string | undefined =
    rootlessLauncher === undefined ? undefined : rootlessLauncherPath;

  return {
    wrapCmd: (cmd) => {
      if (launcherPath !== undefined) {
        // Rootless: `sh <launcher> <rlimit-prelude...> <cmd...>`. The launcher
        // threads its positional args through bwrap into the namespace.
        return ["sh", launcherPath, ...rlimitPrelude, ...cmd];
      }
      return captureCmdPrelude.length > 0
        ? [...captureCmdPrelude, ...cmd]
        : cmd;
    },
    env: finalEnv,
    droppedEnvKeys,
    uid,
    gid,
    maxOutputBytes: policy.resources.maxOutputBytes,
    nodeMemoryFlagEnv,
    nftRuleset,
    rootlessLauncher,
    effective: {
      requested: policy,
      enforced,
      downgrades,
      notes,
      platform: caps.platform,
    },
  };
}
