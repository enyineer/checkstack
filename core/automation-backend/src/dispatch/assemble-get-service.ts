import type { ServiceRef } from "@checkstack/backend-api";

/**
 * Assemble the dispatch engine's `getService` from the plugin `env`.
 *
 * The automation dispatch path is the only context that resolves ARBITRARY
 * cross-plugin service refs (the integration connection store, the secret
 * resolver) OUTSIDE an RPC handler — at action execute time. It does so
 * through the plugin `env.getService`, which resolves via the real
 * `ServiceRegistry` using this plugin's identity.
 *
 * This used to be a throwing stub in `index.ts`, which meant every provider
 * action (Jira / Teams / Webex) and every `secretEnv` script action threw in
 * production. The whole dispatch test suite stubs `getService`, so the break
 * was invisible. Extracting the assembly here lets a unit test assert the
 * production wiring resolves a registered ref (and is NOT a throwing stub),
 * guarding that exact regression.
 *
 * Safe to call from `init` / `afterPluginsReady` onward — dispatch never
 * runs before then, by which point every service is registered. A missing
 * ref propagates a CLEAR error from `env.getService` (fail loud), never a
 * silent `undefined`.
 */
export function assembleDispatchGetService({
  envGetService,
}: {
  /** The plugin `env.getService` — registry-backed resolution. */
  envGetService: <T>(ref: ServiceRef<T>) => Promise<T>;
}): <T>(ref: ServiceRef<T>) => Promise<T> {
  return envGetService;
}
