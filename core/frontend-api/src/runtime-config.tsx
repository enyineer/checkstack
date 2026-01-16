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
 * Fetches runtime config from backend on mount.
 * All consumers should wait for config to load before rendering.
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
        // In development, the proxy handles /api routes
        // In production, this is the same origin
        const response = await fetch("/api/config");
        if (!response.ok) {
          throw new Error(`Failed to fetch config: ${response.status}`);
        }
        const data = (await response.json()) as RuntimeConfig;
        cachedConfig = data; // Populate module-level cache
        setConfig(data);
      } catch (error_) {
        console.error("RuntimeConfigProvider: Failed to load config", error_);
        // Fallback to localhost for development
        const fallback = { baseUrl: "http://localhost:3000" };
        cachedConfig = fallback; // Populate cache even on error
        setConfig(fallback);
        setError(error_ instanceof Error ? error_ : new Error(String(error_)));
      } finally {
        setIsLoading(false);
      }
    };

    fetchConfig();
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
 * Access the runtime config context.
 * Returns { config, isLoading, error }.
 */
export function useRuntimeConfig(): RuntimeConfig {
  const { config, isLoading } = useContext(RuntimeConfigContext);

  if (isLoading || !config) {
    // Return fallback during loading - consumers should check isLoading
    return { baseUrl: "http://localhost:3000" };
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
