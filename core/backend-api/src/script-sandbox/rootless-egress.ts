/**
 * Rootless network egress via `slirp4netns` (the unprivileged fallback for the
 * privileged macvlan path in `network.ts` / `filesystem.ts`).
 *
 * Why this exists: the macvlan path needs CAP_NET_ADMIN (euid root) + a usable
 * host uplink + operator-supplied static addressing. The common rootless
 * container case (rootless Podman/Docker) has NONE of those but DOES have
 * unprivileged user namespaces. `slirp4netns` is the standard rootless plumbing:
 * it runs in the PARENT network namespace and creates a `tap0` device with a
 * userspace TCP/IP stack INSIDE the child's net namespace, NAT'ing egress out
 * through the parent. So the child gets real, addressed, routed egress with no
 * privilege — and we can filter THAT egress with nftables inside the same netns,
 * exactly like the macvlan path.
 *
 * Determinism (no TOCTOU): slirp4netns uses a fixed, built-in addressing plan —
 * subnet `10.0.2.0/24`, child endpoint `10.0.2.100`, gateway `10.0.2.2`. Unlike
 * macvlan there is nothing to pick from the host, so there is no collision/race
 * footgun and nothing to defer to operator env.
 *
 * Correctness of `enforced.network` (the load-bearing invariant): the egress
 * filter is loaded FAIL-CLOSED. The inner command, the first thing it does
 * inside the namespace, installs the nftables ruleset (default-drop egress +
 * the allowlist accepts + the always-on metadata block) BEFORE `tap0` even
 * exists. So the ordering is:
 *   1. child enters userns+netns (loopback only, routeless — no egress yet),
 *   2. child loads the default-drop nft ruleset (still no egress),
 *   3. child signals "namespace ready" to the launcher,
 *   4. launcher runs `slirp4netns --configure` which brings up the ADDRESSED
 *      `tap0` — now the ONLY reachable destinations are the ones the already-
 *      loaded ruleset permits,
 *   5. launcher signals "network ready" back,
 *   6. child execs the real command.
 * If slirp4netns never readies, or nft fails to load, the child has NO filtered
 * egress path — never an UNFILTERED one. There is no window in which traffic
 * flows past an un-loaded filter, so when this path is engaged `enforced.network`
 * is truthful.
 *
 * Mechanism: a single launcher SHELL SCRIPT (staged on disk by the runner, like
 * the nft ruleset) is the wrapper prelude. It uses `bwrap`'s `--info-fd` to
 * learn the child PID race-free, and a pair of FIFOs for the two-way ready
 * handshake. `bwrap` is the only wrapper used here because it cleanly exposes
 * the child PID; nsjail's macvlan path is preferred when privileged anyway.
 *
 * Everything below is PURE string/argv construction so it is fully testable
 * without a real `slirp4netns` (the end-to-end behaviour is gated behind
 * `CHECKSTACK_IT`).
 */

import { shellQuote } from "./shell-quote";

/** slirp4netns built-in deterministic addressing (CIDR/gateway/endpoint). */
export const SLIRP4NETNS_TAP_DEVICE = "tap0";
export const SLIRP4NETNS_SUBNET_CIDR = "10.0.2.0/24";
export const SLIRP4NETNS_GATEWAY = "10.0.2.2";
export const SLIRP4NETNS_CHILD_IP = "10.0.2.100";

/**
 * Inputs for the rootless launcher script. All paths are absolute and supplied
 * by the runner (it owns the per-run scratch dir where these are staged).
 */
export interface RootlessLauncherInputs {
  /**
   * The `bwrap` argv that creates the child user+net namespace and execs the
   * inner command. Built by the filesystem layer with `--unshare-net` (WITHOUT
   * the trailing `--`; the launcher appends `--info-fd N --`).
   */
  bwrapArgv: string[];
  /** Path to the staged nftables ruleset file (loaded fail-closed inside). */
  nftRulesetPath: string;
}

/**
 * Build the inner `sh -c` script run INSIDE the namespace by bwrap. It:
 *  1. loads the nft ruleset (default-drop egress + allowlist + metadata block)
 *     FAIL-CLOSED — exits non-zero if it cannot, so we never run unfiltered,
 *  2. signals "namespace ready" so the launcher can run slirp4netns,
 *  3. waits for "network ready",
 *  4. exec's the real command (passed as the inner shell's positional args).
 *
 * The real command is forwarded as the inner shell's `"$@"` (the launcher
 * receives it as ITS positional args and threads it through bwrap into the
 * inner `sh -c ... <name> "$@"`), so the command argv is NEVER string-spliced
 * into the script body — no quoting of caller-controlled argv is needed.
 *
 * `nft` is loaded with the child as (mapped) root inside its own userns, which
 * is sufficient to populate an `inet` table in the child's own net namespace.
 * If a rule class cannot be loaded rootless, `nft -f` exits non-zero and the
 * whole run fails closed (degrade-and-surface upstream), never silently allows.
 */
export function buildRootlessInnerScript({
  nftRulesetPath,
}: {
  nftRulesetPath: string;
}): string {
  const quotedRuleset = shellQuote(nftRulesetPath);
  // The launcher wires the two ready FIFOs onto fd 9 (write: "namespace ready")
  // and fd 8 (read: "network ready") of this inner shell via bwrap redirection.
  return [
    "set -e",
    // Fail-closed egress filter: default-drop is installed BEFORE tap0 exists,
    // so there is no window where traffic flows past an un-loaded filter.
    `nft -f ${quotedRuleset}`,
    // Tell the launcher the namespace exists + the filter is loaded, so it can
    // attach slirp4netns to our PID.
    "printf ready >&9",
    // Block until the launcher reports tap0 is up + addressed.
    "IFS= read -r _ <&8",
    // exec the real command, forwarded verbatim as positional args.
    'exec "$@"',
  ].join("\n");
}

/**
 * Build the full launcher shell script. This is what the wrapper prelude
 * resolves to: the runner stages it and the spawned argv is `["sh", path]`.
 *
 * The launcher orchestrates the race-free rootless setup:
 *  - creates the two ready FIFOs + a bwrap info pipe,
 *  - spawns bwrap (which forks the namespaced child running the inner script),
 *  - reads the child PID from bwrap's `--info-fd` JSON,
 *  - waits for the child's "namespace ready",
 *  - runs `slirp4netns --configure --ready-fd <fd> <pid> tap0`,
 *  - signals "network ready" to the child,
 *  - waits for the child + propagates its exit code.
 *
 * Any failure (bwrap, slirp4netns, missing PID) aborts the launcher non-zero
 * AFTER ensuring the child never proceeds past its filter load — fail-closed.
 */
export function buildRootlessLauncherScript({
  bwrapArgv,
  nftRulesetPath,
}: RootlessLauncherInputs): string {
  const inner = buildRootlessInnerScript({ nftRulesetPath });
  // bwrap prefix WITHOUT the trailing `--`; the launcher appends `--info-fd`,
  // the `--`, and the inner `sh -c`. `--unshare-net` must already be present
  // (the FS layer adds it); we compose argv purely as strings here.
  const quotedBwrap = bwrapArgv.map((arg) => shellQuote(arg)).join(" ");
  const quotedInner = shellQuote(inner);
  return `#!/bin/sh
# Rootless egress launcher (slirp4netns + fail-closed nftables). Generated by
# @checkstack/backend-api script sandbox. Do not edit.
#
# fd map:
#   7  bwrap --info-fd        -> $info file  (child PID as JSON)
#   8  child "network ready"  <- net_ready FIFO (launcher writes when tap0 up)
#   9  child "namespace ready"-> ns_ready  FIFO (child writes after nft load)
#   3  slirp4netns --ready-fd -> slirp_ready FIFO (slirp writes when tap0 up)
set -eu

work="$(mktemp -d "\${TMPDIR:-/tmp}/checkstack-slirp.XXXXXX")"
ns_ready="$work/ns_ready"
net_ready="$work/net_ready"
slirp_ready="$work/slirp_ready"
info="$work/bwrap_info"
mkfifo "$ns_ready" "$net_ready" "$slirp_ready"

slirp_pid=""
bwrap_pid=""
cleanup() {
  status=$?
  if [ -n "$slirp_pid" ]; then kill "$slirp_pid" 2>/dev/null || true; fi
  rm -rf "$work" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

# Spawn bwrap (which forks the namespaced child running the inner script). The
# real command argv arrives as the launcher's own "$@" and is threaded verbatim
# into the inner shell's positional args (no string splicing of caller argv).
# fd 7 -> info file; child's fd 9 -> ns_ready (write); child's fd 8 <- net_ready.
# bwrap passes inherited fds >=3 through to the sandboxed process (it only
# consumes the ones named by its own options, e.g. --info-fd 7), so fds 8 and 9
# survive into the inner shell for the ready handshake.
${quotedBwrap} --info-fd 7 -- \\
  sh -c ${quotedInner} checkstack-rootless-egress "$@" \\
  7>"$info" 9>"$ns_ready" 8<"$net_ready" &
bwrap_pid=$!

# Wait for the child to announce "namespace ready + filter loaded". By this
# point bwrap has written the child PID to the info file.
IFS= read -r _ <"$ns_ready" || true
child_pid=""
if [ -s "$info" ]; then
  child_pid="$(sed -n 's/.*"child-pid"[: ]*\\([0-9][0-9]*\\).*/\\1/p' "$info")"
fi
if [ -z "$child_pid" ]; then
  echo "rootless-egress: could not determine namespaced child PID" >&2
  kill "$bwrap_pid" 2>/dev/null || true
  wait "$bwrap_pid" 2>/dev/null || true
  exit 70
fi

# Bring up tap0 inside the child's netns with slirp4netns' deterministic
# addressing. --ready-fd writes one byte once tap0 is configured. The child's
# nft filter is ALREADY loaded (default-drop), so egress opens ONLY to the
# permitted destinations — never an unfiltered window.
slirp4netns --configure --mtu=65520 --disable-host-loopback \\
  --ready-fd=3 "$child_pid" ${SLIRP4NETNS_TAP_DEVICE} \\
  3>"$slirp_ready" >/dev/null 2>"$work/slirp_err" &
slirp_pid=$!
if ! IFS= read -r _ <"$slirp_ready"; then
  echo "rootless-egress: slirp4netns failed to ready tap0" >&2
  cat "$work/slirp_err" >&2 2>/dev/null || true
  kill "$bwrap_pid" 2>/dev/null || true
  wait "$bwrap_pid" 2>/dev/null || true
  exit 71
fi

# Tell the child tap0 is up; it then exec's the real command.
printf ready > "$net_ready"

# Propagate the child's exit code. Under set -e a non-zero child makes wait
# itself fail, which fires the EXIT trap with that status (the trap is what
# actually propagates the code); the explicit "|| exit STATUS" makes the
# propagation path obvious to a reader rather than relying on the trap alone.
wait "$bwrap_pid" || exit $?
`;
}
