import { createContext, type Context } from "react";

/**
 * A `React.createContext` replacement whose context object is registered in a
 * process-global registry keyed by a stable string.
 *
 * ## Why this exists
 *
 * `@checkstack/ui` is NOT a shared (vendored / import-mapped) singleton — it is
 * bundled into every consumer (the host app AND each runtime plugin) so it can
 * be tree-shaken (a plugin using a couple of components ships a couple of KB,
 * not the whole 2 MB kit incl. Monaco/recharts). See the runtime
 * frontend-plugin sharing design.
 *
 * But a few of its values MUST behave as singletons: the Theme / Toast /
 * Performance React contexts. The host mounts the providers; a plugin's
 * components call the matching hooks. With `@checkstack/ui` duplicated per
 * bundle, a plain `createContext()` would create a DIFFERENT context object in
 * each copy, so a plugin's `usePerformance()` would read its own empty context
 * instead of the host's provider value.
 *
 * Registering the context on `globalThis` by key fixes that: whichever copy
 * loads first (always the host, which boots before any plugin) creates and
 * registers the context; every later copy returns that same instance. React
 * itself is the shared singleton (resolved via the import map), so the context
 * object is usable across the bundles. This is the well-established
 * "singleton context" pattern for shared React context from a bundled-per-MFE
 * library (cf. `@indeedeng/react-singleton-context`).
 *
 * Only contexts that are genuinely shared between host and plugins need this;
 * purely internal component state should keep using plain `createContext`.
 */

const REGISTRY_KEY = "__checkstackUiContextRegistry__";

// The registry stores contexts for heterogeneous value types keyed by string,
// so it cannot be typed per key; values are stored as `Context<unknown>` and
// narrowed back by the caller's `T` on read. This single, contained cast is
// the reason the registry is wrapped in this helper instead of inlined.
type ContextRegistry = Map<string, Context<unknown>>;

function getRegistry(): ContextRegistry {
  const holder = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: ContextRegistry;
  };
  holder[REGISTRY_KEY] ??= new Map<string, Context<unknown>>();
  return holder[REGISTRY_KEY];
}

export function createRegisteredContext<T>(
  key: string,
  // Optional so callers whose `T` includes `undefined` (a context that is
  // absent until a provider mounts) can omit it rather than pass a literal
  // `undefined` argument.
  ...defaultValue: [T] | []
): Context<T> {
  const registry = getRegistry();
  const existing = registry.get(key);
  if (existing) {
    // Safe by construction: a given `key` is always created with the same `T`.
    return existing as Context<T>;
  }
  // `defaultValue[0]` is `undefined` only when the caller omitted it, in which
  // case `T` includes `undefined`; otherwise it is the provided `T`.
  const context = createContext<T>(defaultValue[0] as T);
  registry.set(key, context as Context<unknown>);
  return context;
}
