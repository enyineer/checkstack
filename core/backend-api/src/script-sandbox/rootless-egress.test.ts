import { describe, expect, it } from "bun:test";
import {
  buildRootlessInnerScript,
  buildRootlessLauncherScript,
  SLIRP4NETNS_CHILD_IP,
  SLIRP4NETNS_GATEWAY,
  SLIRP4NETNS_TAP_DEVICE,
} from "./rootless-egress";

describe("buildRootlessInnerScript — fail-closed filter ordering", () => {
  const inner = buildRootlessInnerScript({ nftRulesetPath: "/run/egress.nft" });

  it("loads the nft filter BEFORE signalling readiness or exec'ing", () => {
    const nftIdx = inner.indexOf("nft -f");
    const readyIdx = inner.indexOf("printf ready >&9");
    const execIdx = inner.indexOf('exec "$@"');
    // Filter loads first, THEN we announce the namespace, THEN exec the command.
    expect(nftIdx).toBeGreaterThanOrEqual(0);
    expect(nftIdx).toBeLessThan(readyIdx);
    expect(readyIdx).toBeLessThan(execIdx);
  });

  it("is `set -e` so a failed nft load aborts before exec (never unfiltered)", () => {
    expect(inner.startsWith("set -e")).toBe(true);
  });

  it("waits for the launcher's network-ready signal before exec", () => {
    const readyIdx = inner.indexOf("printf ready >&9");
    const waitIdx = inner.indexOf("IFS= read -r _ <&8");
    const execIdx = inner.indexOf('exec "$@"');
    expect(readyIdx).toBeLessThan(waitIdx);
    expect(waitIdx).toBeLessThan(execIdx);
  });

  it("execs the real command via positional args (no string splicing)", () => {
    expect(inner).toContain('exec "$@"');
  });
});

describe("buildRootlessLauncherScript — slirp4netns orchestration", () => {
  const launcher = buildRootlessLauncherScript({
    bwrapArgv: ["bwrap", "--unshare-all", "--unshare-net", "--die-with-parent"],
    nftRulesetPath: "/run/egress.nft",
  });

  it("invokes bwrap with --info-fd for a race-free child PID handshake", () => {
    expect(launcher).toContain("--info-fd 7");
  });

  it("threads the real command through bwrap's inner sh as positional args", () => {
    // `sh -c <inner> checkstack-rootless-egress "$@"` forwards the launcher's
    // own "$@" (the real command) verbatim into the namespace.
    expect(launcher).toContain('checkstack-rootless-egress "$@"');
  });

  it("configures slirp4netns with the deterministic tap device + ready-fd", () => {
    expect(launcher).toContain("slirp4netns --configure");
    expect(launcher).toContain("--ready-fd=3");
    expect(launcher).toContain(SLIRP4NETNS_TAP_DEVICE);
  });

  it("signals the child only AFTER slirp4netns readies tap0 (no unfiltered window)", () => {
    const slirpReadIdx = launcher.indexOf('IFS= read -r _ <"$slirp_ready"');
    const netReadyIdx = launcher.indexOf('printf ready > "$net_ready"');
    expect(slirpReadIdx).toBeGreaterThanOrEqual(0);
    expect(netReadyIdx).toBeGreaterThanOrEqual(0);
    // The launcher waits for slirp4netns readiness, THEN releases the child.
    expect(slirpReadIdx).toBeLessThan(netReadyIdx);
  });

  it("fails closed (non-zero exit) when the child PID cannot be determined", () => {
    expect(launcher).toContain("exit 70");
  });

  it("fails closed (non-zero exit) when slirp4netns never readies", () => {
    expect(launcher).toContain("exit 71");
  });

  it("propagates the child's exit code", () => {
    expect(launcher).toContain('wait "$bwrap_pid"');
    expect(launcher).toContain("exit $?");
  });

  it("tears down slirp4netns + temp FIFOs on every exit path", () => {
    expect(launcher).toContain("trap cleanup EXIT INT TERM");
    expect(launcher).toContain('kill "$slirp_pid"');
    expect(launcher).toContain('rm -rf "$work"');
  });

  it("embeds the provided bwrap argv verbatim (quoted)", () => {
    expect(launcher).toContain("'bwrap' '--unshare-all' '--unshare-net'");
  });

  it("documents the deterministic addressing constants", () => {
    // Sanity: the deterministic slirp4netns plan is stable (no operator input).
    expect(SLIRP4NETNS_CHILD_IP).toBe("10.0.2.100");
    expect(SLIRP4NETNS_GATEWAY).toBe("10.0.2.2");
  });
});
