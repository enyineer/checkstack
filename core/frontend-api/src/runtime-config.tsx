import { createContext, useContext, useState, useEffect } from "react";

// =============================================================================
// RUNTIME CONFIG TYPES
// =============================================================================

export interface RuntimeConfig {
  /** Base URL for API calls and WebSocket connections */
  baseUrl: string;
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
  const [config, setConfig] = useState<RuntimeConfig | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
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
        // origin — same-origin is trivially reachable.
        const currentOrigin = getCurrentOrigin();
        if (currentOrigin && data.baseUrl !== currentOrigin) {
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
