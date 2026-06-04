import {
  detectSandboxCapabilities,
  type SandboxCapabilities,
} from "./capabilities";

/**
 * Whether THIS host can actually enforce the OS-level sandbox layers, plus
 * developer-facing guidance when it cannot.
 *
 * The OS-level isolation (filesystem / network / privilege / resources) is
 * built on LINUX kernel primitives - unprivileged user + net namespaces via
 * `bubblewrap`, `prlimit` rlimits, `nftables` / `slirp4netns` egress. On
 * macOS / Windows (and on a Linux host missing the primitives or with
 * unprivileged user namespaces blocked) none of that is available, so under
 * the secure fail-closed default policy (`onUnavailable: "fail"`) the runners
 * correctly REFUSE every run rather than execute it unsandboxed.
 *
 * This assessment lets a process surface that situation ONCE at startup with
 * actionable guidance, instead of every script run failing with an opaque
 * "sandbox unavailable" error. It does NOT change the policy or relax
 * enforcement - the durable global policy remains the single source of truth.
 */
export interface SandboxHostReadiness {
  /**
   * True when the host can enforce the OS-level sandbox layers (Linux with a
   * namespace-capable wrapper, creatable user+net namespaces, and `prlimit`).
   */
  enforceable: boolean;
  /** The detected host platform. */
  platform: SandboxCapabilities["platform"];
  /**
   * Human-readable reasons the OS layer cannot be enforced. Empty when
   * {@link enforceable} is true.
   */
  reasons: string[];
  /**
   * Multi-line developer/operator guidance: why runs are refused under the
   * fail-closed default, and the two supported local-development paths
   * (Docker prod-parity, or an explicit `degrade` policy). Empty string when
   * {@link enforceable} is true.
   */
  guidance: string;
}

/**
 * Assess whether the host can enforce the OS-level sandbox, and build the
 * developer guidance shown when it cannot. Pure over the detected (cached)
 * capabilities; pass `caps` to test specific hosts.
 */
export function assessSandboxHostReadiness({
  caps = detectSandboxCapabilities(),
}: { caps?: SandboxCapabilities } = {}): SandboxHostReadiness {
  const reasons: string[] = [];

  if (caps.platform === "linux") {
    if (caps.wrapper === null) {
      reasons.push(
        "no namespace-capable wrapper found on PATH (install bubblewrap, or nsjail)",
      );
    }
    if (!caps.userNsCreatable) {
      reasons.push(
        "unprivileged user + net namespaces cannot be created on this host (kernel toggle off, or blocked by the container seccomp profile - see the bundled seccomp profile + /proc unmask requirement)",
      );
    }
    if (!caps.rlimitNative) {
      reasons.push("prlimit (util-linux) is not available for resource limits");
    }
  } else {
    reasons.push(
      `OS-level isolation requires Linux kernel primitives (bubblewrap namespaces, prlimit, nftables); this host is ${caps.platform}`,
    );
  }

  const enforceable = reasons.length === 0;
  if (enforceable) {
    return { enforceable, platform: caps.platform, reasons, guidance: "" };
  }

  const guidance = [
    "Script sandbox: OS-level isolation is UNAVAILABLE on this host:",
    ...reasons.map((reason) => `  - ${reason}`),
    'Under the secure fail-closed default policy (onUnavailable: "fail") script runs are REFUSED rather than run unsandboxed. For local development you have two supported options:',
    "  1. Prod-parity enforcement: run the runtime inside the Linux sandbox container (docker-compose.yml ships the required seccomp profile + /proc unmask). On macOS / Windows this uses Docker Desktop's Linux VM and enforces exactly as production does.",
    '  2. Fast native dev: set the global Script Sandbox policy to "degrade" in Admin -> Settings -> Script Sandbox. Scripts then run with the PORTABLE SUBSET (wall-clock timeout + output truncation, NO OS isolation) - acceptable for your own dev scripts, never a security boundary.',
    "Production MUST run on Linux. See docs: developer-guide/security/script-sandbox (Local development).",
  ].join("\n");

  return { enforceable, platform: caps.platform, reasons, guidance };
}

/**
 * Frame the readiness guidance in a high-visibility banner so it stands out in
 * terminal scrollback even when a multi-process dev runner (e.g. Bun's
 * `--filter` view, which elides per-task output) interleaves or collapses logs.
 * Returns the empty string when the host can enforce the sandbox (nothing to
 * surface).
 */
export function formatSandboxReadinessBanner({
  readiness,
}: {
  readiness: SandboxHostReadiness;
}): string {
  if (readiness.enforceable) return "";
  const rule = "=".repeat(78);
  // The headline is the FIRST line so it carries the logger's level prefix
  // (e.g. winston `warn:`) and therefore surfaces as a real entry in a log
  // viewer's alerts/warnings, instead of an empty leading line. The rules +
  // detailed guidance follow as continuation lines.
  return [
    "SCRIPT SANDBOX: OS-LEVEL ISOLATION UNAVAILABLE ON THIS HOST",
    rule,
    readiness.guidance,
    rule,
    "",
  ].join("\n");
}
