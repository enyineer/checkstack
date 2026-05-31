import type { ServiceRef } from "@checkstack/backend-api";
import {
  maskSecrets,
  maskSecretsDeep,
} from "@checkstack/secrets-common";

/**
 * Run-scoped accumulation of every secret VALUE resolved during a dispatch
 * run, so the run-state persistence layer can mask it out of step / run
 * output before it is written (and therefore before any DTO / run-detail
 * page can read it). Jenkins-style, by-value, least-privilege: a run's set
 * holds ONLY the values that run actually resolved.
 *
 * Capture happens by wrapping the run's `getService` (see
 * {@link wrapGetServiceForRun}) so that resolving the secret resolver or
 * connection store during the run registers the resolved values here. The
 * resolved values themselves stay in memory only — this registry is never
 * persisted, and a run's entry is dropped when the run reaches a terminal
 * state.
 */
export interface RunSecretRegistry {
  /** Register resolved secret values for a run (deduped, in memory). */
  register(runId: string, values: Iterable<string>): void;
  /**
   * Associate a step with its run, so step writes (which carry only a
   * stepId) can find the run's mask set without threading runId through
   * every `updateStep` caller.
   */
  linkStep(stepId: string, runId: string): void;
  /** Mask every registered value out of `text` for a run. No-op if none. */
  maskText(runId: string, text: string): string;
  /** Mask every registered value out of a JSON-like payload for a run. */
  maskDeep(runId: string, value: unknown): unknown;
  /** Mask `text` using the run that owns `stepId`. */
  maskTextForStep(stepId: string, text: string): string;
  /** Mask a payload using the run that owns `stepId`. */
  maskDeepForStep(stepId: string, value: unknown): unknown;
  /** Drop a run's accumulated values + its step links (terminal status). */
  drop(runId: string): void;
}

export function createRunSecretRegistry(): RunSecretRegistry {
  const byRun = new Map<string, Set<string>>();
  const stepToRun = new Map<string, string>();

  const maskTextForRun = (runId: string, text: string): string => {
    const set = byRun.get(runId);
    if (!set || set.size === 0) return text;
    return maskSecrets({ text, values: set });
  };
  const maskDeepForRun = (runId: string, value: unknown): unknown => {
    const set = byRun.get(runId);
    if (!set || set.size === 0) return value;
    return maskSecretsDeep({ value, values: set });
  };

  return {
    register(runId, values) {
      let set = byRun.get(runId);
      if (!set) {
        set = new Set<string>();
        byRun.set(runId, set);
      }
      for (const v of values) {
        if (typeof v === "string" && v.length > 0) set.add(v);
      }
    },

    linkStep(stepId, runId) {
      stepToRun.set(stepId, runId);
    },

    maskText: maskTextForRun,
    maskDeep: maskDeepForRun,

    maskTextForStep(stepId, text) {
      const runId = stepToRun.get(stepId);
      return runId ? maskTextForRun(runId, text) : text;
    },
    maskDeepForStep(stepId, value) {
      const runId = stepToRun.get(stepId);
      return runId ? maskDeepForRun(runId, value) : value;
    },

    drop(runId) {
      byRun.delete(runId);
      for (const [stepId, rid] of stepToRun) {
        if (rid === runId) stepToRun.delete(stepId);
      }
    },
  };
}

/**
 * Wrap a run's `getService` so resolving the secret resolver or the
 * connection store registers every resolved value into the
 * {@link RunSecretRegistry} for this run. This is the single capture point
 * for run-wide masking: any action that resolves secrets (script
 * `secretEnv`, a `${{ secrets.NAME }}` template, or a provider connection
 * credential) contributes its resolved values to the run's mask set,
 * least-privilege.
 *
 * `refs` carries the ids to intercept (the resolver + connection-store
 * refs); other services pass through untouched. Ids are passed in (rather
 * than imported) to avoid a hard dependency cycle on the secrets / integration
 * packages from the dispatch core.
 */
export function wrapGetServiceForRun(input: {
  getService: <T>(ref: ServiceRef<T>) => Promise<T>;
  runId: string;
  registry: RunSecretRegistry;
  /** Service-ref id of the secret resolver (`secretResolverRef`). */
  resolverRefId: string;
  /** Service-ref id of the connection store (`connectionStoreRef`). */
  connectionStoreRefId: string;
}): <T>(ref: ServiceRef<T>) => Promise<T> {
  const { getService, runId, registry, resolverRefId, connectionStoreRefId } =
    input;

  return async <T>(ref: ServiceRef<T>): Promise<T> => {
    const service = await getService(ref);
    if (ref.id === resolverRefId) {
      return wrapResolver(service, runId, registry);
    }
    if (ref.id === connectionStoreRefId) {
      return wrapConnectionStore(service, runId, registry);
    }
    return service;
  };
}

// ─── Service proxies that register resolved values ─────────────────────────

// Minimal structural shapes of the methods that return secret values. We
// avoid importing the concrete service types to keep the dispatch core free
// of a dependency on the secrets / integration packages.

interface ResolverLike {
  resolveSecret(input: { name: string }): Promise<string>;
  resolveForRun(input: { secretEnv: Record<string, string> }): Promise<{
    env: Record<string, string>;
    masking: unknown;
  }>;
  resolveBySchema(input: {
    value: unknown;
    schema: unknown;
  }): Promise<{ resolved: unknown; warnings: string[] }>;
}

interface ConnectionStoreLike {
  getConnectionWithCredentials(
    connectionId: string,
  ): Promise<{ config: Record<string, unknown> } | undefined>;
}

function hasResolverShape(s: unknown): s is ResolverLike {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as ResolverLike).resolveForRun === "function" &&
    typeof (s as ResolverLike).resolveSecret === "function"
  );
}

function hasConnectionStoreShape(s: unknown): s is ConnectionStoreLike {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as ConnectionStoreLike).getConnectionWithCredentials ===
      "function"
  );
}

/** Collect every string leaf in a JSON-like value (resolved cred values). */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

function wrapResolver<T>(service: T, runId: string, registry: RunSecretRegistry): T {
  if (!hasResolverShape(service)) return service;
  const inner = service as ResolverLike & Record<string, unknown>;
  // Proxy that intercepts ONLY the three value-returning methods (to
  // register resolved secrets) and forwards every other method / property
  // untouched via Reflect.get. Mirrors `wrapConnectionStore` — a hand-built
  // literal would silently drop any resolver method we didn't re-declare.
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "resolveSecret") {
        return async (input: { name: string }) => {
          const value = await inner.resolveSecret(input);
          registry.register(runId, [value]);
          return value;
        };
      }
      if (prop === "resolveForRun") {
        return async (input: { secretEnv: Record<string, string> }) => {
          const result = await inner.resolveForRun(input);
          registry.register(runId, Object.values(result.env));
          return result;
        };
      }
      if (prop === "resolveBySchema") {
        return async (input: { value: unknown; schema: unknown }) => {
          const result = await inner.resolveBySchema(input);
          const strings: string[] = [];
          collectStrings(result.resolved, strings);
          registry.register(runId, strings);
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as T;
}

function wrapConnectionStore<T>(
  service: T,
  runId: string,
  registry: RunSecretRegistry,
): T {
  if (!hasConnectionStoreShape(service)) return service;
  const inner = service as ConnectionStoreLike & Record<string, unknown>;
  // Preserve all the store's other methods; only the credential resolver
  // registers values.
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "getConnectionWithCredentials") {
        return async (connectionId: string) => {
          const conn = await inner.getConnectionWithCredentials(connectionId);
          if (conn) {
            const strings: string[] = [];
            collectStrings(conn.config, strings);
            registry.register(runId, strings);
          }
          return conn;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as T;
}
