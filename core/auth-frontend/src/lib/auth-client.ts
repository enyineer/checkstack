import { createAuthClient } from "better-auth/react";
import { getCachedRuntimeConfig } from "@checkstack/frontend-api";

// Cache for lazy-initialized client
let cachedClient: ReturnType<typeof createAuthClient> | undefined;
let cachedBaseUrl: string | undefined;

/**
 * Lazy-initialized auth client for imperative (non-hook) APIs like
 * `getAuthClientLazy().listAccounts()` or `getAuthClientLazy().signOut()`.
 *
 * Uses the cached runtime config from RuntimeConfigProvider.
 *
 * IMPORTANT: Do NOT call `.useSession()` on this client from components.
 * Use `authApi.useSession()` (via `useApi(authApiRef)`) instead — it reads
 * from the shared SessionProvider context and does not trigger extra fetches.
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

