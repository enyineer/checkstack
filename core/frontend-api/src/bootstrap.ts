import type { RuntimeConfig } from "./runtime-config";

/**
 * The server-inlined boot payload. The backend writes this into the served HTML
 * (see `injectBootstrap` in `@checkstack/backend`) so the SPA can read its
 * config and plugin list synchronously at boot instead of fetching them
 * serially before first paint.
 */
export interface FrontendBootstrap {
  /** Same payload `/api/config` returns. */
  config: RuntimeConfig;
  /** Same payload `/api/plugins` returns: remote (installed) frontend plugins. */
  enabledPlugins: { name: string; path: string }[];
}

/** The global the injected script writes and the frontend reads. */
export const BOOTSTRAP_GLOBAL = "__CHECKSTACK_BOOTSTRAP__";

/**
 * Read the server-inlined bootstrap blob.
 *
 * Returns `undefined` when absent: the Vite dev server serves a STATIC
 * index.html with no injected global, so dev falls back to the `/api/config`
 * and `/api/plugins` fetches. The value is written by our own same-origin
 * backend into our own HTML, so a structural shape check is sufficient here; it
 * is never treated as untrusted user input.
 */
export function readBootstrap(): FrontendBootstrap | undefined {
  const raw = (globalThis as Record<string, unknown>)[BOOTSTRAP_GLOBAL];
  return isFrontendBootstrap(raw) ? raw : undefined;
}

function isFrontendBootstrap(value: unknown): value is FrontendBootstrap {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;

  if (typeof obj.config !== "object" || obj.config === null) return false;
  const config = obj.config as Record<string, unknown>;
  if (typeof config.baseUrl !== "string") return false;

  return Array.isArray(obj.enabledPlugins);
}
