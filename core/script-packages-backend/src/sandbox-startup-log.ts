import {
  assessSandboxHostReadiness,
  detectSandboxCapabilities,
  formatSandboxReadinessBanner,
  logSandboxCapabilitiesAtStartup,
  type SandboxCapabilities,
  type SandboxLogger,
  type SandboxPolicy,
} from "@checkstack/backend-api";

/**
 * The startup logger surface this module needs: the narrow {@link SandboxLogger}
 * (`info` / `warn`) plus a `debug` channel for the positive readiness line.
 */
export interface SandboxStartupLogger extends SandboxLogger {
  debug(message: string, ...args: unknown[]): void;
}

/**
 * Emit the one-time, per-pod script-sandbox startup observability — the host
 * readiness banner AND the capability/enforcement line for the configured
 * global default — entirely IN PROCESS.
 *
 * WHY THIS LIVES HERE (and not in the script plugins): `script-packages` is the
 * single owner of the global sandbox policy (it holds the durable row and
 * registers the one process-wide provider). It can therefore read the policy
 * directly via `readPolicy` — the in-process {@link SandboxPolicyService.read}
 * closure — with NO HTTP RPC round-trip.
 *
 * The previous design had BOTH script plugins
 * (`healthcheck-script-backend`, `integration-script-backend`) call the
 * `getSandboxPolicy` oRPC during their own init to log this line. That route is
 * only mounted once `script-packages` init runs `rpc.registerRouter`, and the
 * plugin init order is topologically derived from runtime service-provider
 * edges (NOT npm package deps) — the script plugins consume no service that
 * `script-packages` provides, so nothing forces `script-packages` to init
 * first. When a script plugin initialised first, the route was absent and the
 * self-loop POST returned `404 Not Found`, producing the noisy
 * "Could not log script sandbox capabilities at startup: Error: Not Found"
 * warnings. Reading in-process removes that ordering dependency, removes the
 * duplicate (two plugins logging the same host/policy), and never touches the
 * enforcement path (runners still resolve via `resolveActiveSandboxPolicy`).
 *
 * Best-effort: a read failure is logged as a warning and swallowed so a
 * transient DB error never crashes boot.
 */
export async function logSandboxStartupReadiness({
  logger,
  readPolicy,
  caps = detectSandboxCapabilities(),
}: {
  logger: SandboxStartupLogger;
  /** In-process read of the durable global default policy. */
  readPolicy: () => Promise<SandboxPolicy>;
  /** Detected host capabilities; injectable for tests. */
  caps?: SandboxCapabilities;
}): Promise<void> {
  // Surface, once at startup, whether this host can enforce the OS-level
  // sandbox. Under the secure fail-closed default every run would otherwise
  // fail with an opaque "sandbox unavailable" error on a non-Linux / unprimed
  // host; the banner points the developer at the supported paths. It does NOT
  // relax enforcement — the durable global policy stays the single source of
  // truth.
  const readiness = assessSandboxHostReadiness({ caps });
  if (readiness.enforceable) {
    logger.debug(
      "✅ Script sandbox: OS-level isolation is available on this host.",
    );
  } else {
    logger.warn(formatSandboxReadinessBanner({ readiness }));
  }

  // The detailed capability + effective-enforcement line for the configured
  // global default. Best-effort: a read failure must not crash startup.
  try {
    const globalDefault = await readPolicy();
    logSandboxCapabilitiesAtStartup({ logger, globalDefault, caps });
  } catch (error) {
    logger.warn(
      `Could not log script sandbox capabilities at startup: ${String(error)}`,
    );
  }
}
