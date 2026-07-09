import { createContext, useContext, useState, useEffect } from "react";
import { readBootstrap } from "./bootstrap";

// =============================================================================
// RUNTIME CONFIG TYPES
// =============================================================================

export interface RuntimeConfig {
  /** Base URL for API calls and WebSocket connections */
  baseUrl: string;
  /**
   * Present only when this page is served on a custom public-domain host. The
   * backend's `/api/config` injects it so the minimal public bundle knows which
   * published page to render without a URL path. Absent on the admin origin.
   */
  publicHost?: {
    kind: string;
    /** The published page's slug; absent when the domain has no live page. */
    slug?: string;
    /**
     * The Host is a CONFIGURED custom domain that is NOT currently servable
     * (unverified, unpublished, or non-public). The public bundle shows a
     * neutral "not available" page; the admin shell is never served here.
     */
    unavailable?: boolean;
  };
  /**
   * Same-origin URL path prefixes (e.g. `/statuspage/view`) whose pages are
   * public surfaces and must render via the LEAN public bundle rather than the
   * admin app. Contributed by plugins through the backend's
   * `publicPathExtensionPoint` and read by the SPA entry (`main.tsx`). Present
   * only on the primary/admin origin.
   */
  publicPathPrefixes?: string[];
  /**
   * The instance NAMESPACE this backend runs as, when it is a SECONDARY instance
   * (e.g. the PR-preview instance booted alongside the normal dev instance). The
   * admin SPA renders a "preview instance" banner when this is present. Absent
   * (undefined) on the default instance. See the backend's `instanceRuntime` and
   * the developer-guide "parallel instances" page.
   */
  instanceNamespace?: string;
}

interface RuntimeConfigContextValue {
  config: RuntimeConfig | undefined;
  isLoading: boolean;
  error: Error | undefined;
}

// Module-level cache for synchronous access from non-React code
let cachedConfig: RuntimeConfig | undefined;

/**
 * Get the cached runtime config synchronously.
 * Returns undefined if config hasn't been loaded yet.
 * Use this for class-based APIs that can't use hooks.
 */
export function getCachedRuntimeConfig(): RuntimeConfig | undefined {
  return cachedConfig;
}

/**
 * Seed the module cache from the server-inlined bootstrap blob, if present.
 *
 * When the backend inlines the config into the served HTML (the production
 * path), this lets the very first synchronous read - and class APIs via
 * `getCachedRuntimeConfig` - see the config with ZERO network round-trips.
 * Returns the seeded config, or undefined when no blob was inlined (e.g. the
 * Vite dev server serves a static index.html), in which case the provider falls
 * back to fetching `/api/config`.
 */
function getSeededConfig(): RuntimeConfig | undefined {
  if (cachedConfig) return cachedConfig;
  const boot = readBootstrap();
  if (boot) cachedConfig = boot.config;
  return cachedConfig;
}

const RuntimeConfigContext = createContext<RuntimeConfigContextValue>({
  config: undefined,
  isLoading: true,
  error: undefined,
});

// =============================================================================
// PROVIDER
// =============================================================================

interface RuntimeConfigProviderProps {
  children: React.ReactNode;
}

/**
 * Safely reads the current page origin without requiring the DOM lib
 * to be in scope in every consuming package's tsconfig.
 *
 * Accesses `location` via `globalThis` cast to avoid the untyped-global
 * error that appears when non-browser packages (e.g. catalog-common) run
 * TypeScript against this file and their tsconfig doesn't include "DOM".
 */
function getCurrentOrigin(): string | undefined {
  const g = globalThis as Record<string, unknown>;
  const loc = g["location"] as { origin?: string } | undefined;
  const origin = loc?.origin;
  return typeof origin === "string" && origin.length > 0 ? origin : undefined;
}

/**
 * Fetches runtime config from the backend on mount, then validates the returned
 * `baseUrl` is actually reachable.
 *
 * Why the probe step matters: `/api/config` is always fetched from the current
 * origin and always succeeds — but the `baseUrl` it returns could point to the
 * wrong port (e.g. the Vite dev server) if `BASE_URL` is misconfigured.
 * Without the probe, all subsequent API calls silently fail with CORS/network
 * errors and the user sees an empty, unresponsive dashboard (issue #79).
 *
 * Probe logic:
 * - If `baseUrl` matches the current page origin → trivially reachable, skip probe.
 * - Otherwise → HEAD-request `${baseUrl}/api/config` with a 5 s timeout.
 *   A connection error here means the baseUrl is wrong.
 */
export const RuntimeConfigProvider: React.FC<RuntimeConfigProviderProps> = ({
  children,
}) => {
  // A seeded config (inlined by the backend) whose baseUrl is the current
  // origin is trivially reachable: render IMMEDIATELY with zero round-trips and
  // skip the probe entirely. A seeded cross-origin baseUrl (the rare misconfig
  // case) still goes through the fetch + probe path below so issue #79's loud
  // error is preserved; a missing seed (dev server) falls back to fetching.
  const seeded = getSeededConfig();
  const seededReady =
    seeded !== undefined &&
    (() => {
      const origin = getCurrentOrigin();
      return origin === undefined || seeded.baseUrl === origin;
    })();

  const [config, setConfig] = useState<RuntimeConfig | undefined>(
    seededReady ? seeded : undefined,
  );
  const [isLoading, setIsLoading] = useState(!seededReady);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    // Recompute readiness inside the effect (deterministic, no render-scope
    // capture) so this boot-once effect keeps an empty dependency list. A
    // same-origin seeded config is already in state — nothing to fetch.
    const s = getSeededConfig();
    if (s) {
      const origin = getCurrentOrigin();
      if (origin === undefined || s.baseUrl === origin) return;
    }

    const fetchConfig = async () => {
      try {
        // Step 1: Fetch config from same-origin backend (always succeeds).
        const response = await fetch("/api/config");
        if (!response.ok) {
          throw new Error(`Failed to fetch runtime config: ${response.status}`);
        }
        const data = (await response.json()) as RuntimeConfig;

        // Step 2: Validate the returned baseUrl is actually reachable.
        // We only need to probe when baseUrl differs from the current page
        // origin — same-origin is trivially reachable. On a custom public-domain
        // host (`publicHost` present) the backend already returns THIS origin as
        // baseUrl, so treat it as same-origin and skip the cross-origin probe:
        // proxy scheme/port variance would otherwise re-fire it and CORS-block,
        // producing a false "cannot reach BASE_URL" screen.
        const currentOrigin = getCurrentOrigin();
        if (currentOrigin && data.baseUrl !== currentOrigin && !data.publicHost) {
          try {
            await fetch(`${data.baseUrl}/api/config`, {
              method: "HEAD",
              signal: AbortSignal.timeout(5000),
            });
          } catch {
            // baseUrl is not reachable — misconfigured BASE_URL env var.
            setError(
              new Error(
                `BASE_URL is set to "${data.baseUrl}" but it cannot be reached. ` +
                  `Update BASE_URL in your .env to match the port your container exposes (e.g. ${currentOrigin}).`
              )
            );
            // Don't set config so the error screen renders.
            return;
          }
        }

        cachedConfig = data;
        setConfig(data);
      } catch (error_) {
        console.error("RuntimeConfigProvider: Failed to load config", error_);
        setError(
          // eslint-disable-next-line no-restricted-syntax -- Needs Error object for state, not just message
          error_ instanceof Error ? error_ : new Error(String(error_))
        );
        // Do NOT set a fallback — surface the error visibly.
      } finally {
        setIsLoading(false);
      }
    };

    void fetchConfig();
  }, []);

  return (
    <RuntimeConfigContext.Provider value={{ config, isLoading, error }}>
      {children}
    </RuntimeConfigContext.Provider>
  );
};

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Access the runtime config. Consumers should check isLoading first.
 */
export function useRuntimeConfig(): RuntimeConfig {
  const { config, isLoading } = useContext(RuntimeConfigContext);

  if (isLoading || !config) {
    // Return a safe fallback while loading — consumers must check isLoading
    // if they need to block on the config being available.
    return { baseUrl: getCurrentOrigin() ?? "http://localhost:3000" };
  }

  return config;
}

/**
 * Check if runtime config is still loading.
 */
export function useRuntimeConfigLoading(): boolean {
  return useContext(RuntimeConfigContext).isLoading;
}

/**
 * Get the raw context value including loading and error states.
 */
export function useRuntimeConfigContext(): RuntimeConfigContextValue {
  return useContext(RuntimeConfigContext);
}
