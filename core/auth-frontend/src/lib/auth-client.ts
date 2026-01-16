import { useMemo } from "react";
import { createAuthClient } from "better-auth/react";
import {
  useRuntimeConfig,
  getCachedRuntimeConfig,
} from "@checkstack/frontend-api";

// Cache for lazy-initialized client
let cachedClient: ReturnType<typeof createAuthClient> | undefined;
let cachedBaseUrl: string | undefined;

/**
 * React hook to get the auth client with proper runtime config.
 * Uses RuntimeConfigProvider to get the base URL.
 */
export function useAuthClient() {
  const { baseUrl } = useRuntimeConfig();

  return useMemo(
    () =>
      createAuthClient({
        baseURL: baseUrl,
        basePath: "/api/auth",
      }),
    [baseUrl]
  );
}

/**
 * Lazy-initialized auth client for class-based APIs.
 * Uses the cached runtime config from RuntimeConfigProvider.
 *
 * Note: This should only be called AFTER RuntimeConfigProvider has loaded.
 * Components rendered inside the provider tree are guaranteed to have config available.
 */
export function getAuthClientLazy(): ReturnType<typeof createAuthClient> {
  const config = getCachedRuntimeConfig();
  const baseUrl = config?.baseUrl ?? "http://localhost:3000";

  // Recreate client if baseUrl changed or not yet created
  if (!cachedClient || cachedBaseUrl !== baseUrl) {
    cachedBaseUrl = baseUrl;
    cachedClient = createAuthClient({
      baseURL: baseUrl,
      basePath: "/api/auth",
    });
  }

  return cachedClient;
}
