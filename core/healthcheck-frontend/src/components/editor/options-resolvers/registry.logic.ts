import type { OptionsResolver } from "@checkstack/ui";
import type {
  ConfigOptionsResolverContext,
  ConfigOptionsResolverMetadata,
} from "./slot";

/**
 * The editor works with FULLY-QUALIFIED strategy ids (`pluginId.strategyId`,
 * e.g. `logstream.logstream` - what `getStrategies` returns and what a stored
 * configuration carries), while contributors declare the UNQUALIFIED id their
 * strategy registered under (the slot contract). Match either form: the
 * qualified id verbatim, or its tail after the last dot (the registry
 * qualifies as `<pluginId>.<strategyId>`, so the unqualified id is the
 * last-dot tail even when the plugin id itself contains dots).
 */
export function strategyIdMatches({
  contributed,
  active,
}: {
  contributed: string;
  active: string;
}): boolean {
  if (contributed === active) return true;
  const lastDot = active.lastIndexOf(".");
  return lastDot > 0 && active.slice(lastDot + 1) === contributed;
}

/**
 * Merge every contributed factory whose `strategyId` matches the strategy being
 * edited into a single `resolverName -> resolver` map. Later contributors win on
 * a name clash (last-registered), which is fine because resolver names are
 * plugin-namespaced by convention (e.g. `logstreamStreamId`).
 */
export function buildResolverMap({
  extensions,
  strategyId,
  ctx,
}: {
  extensions: ReadonlyArray<{ metadata: ConfigOptionsResolverMetadata }>;
  strategyId: string | undefined;
  ctx: ConfigOptionsResolverContext;
}): Record<string, OptionsResolver> {
  const map: Record<string, OptionsResolver> = {};
  if (!strategyId) return map;
  for (const ext of extensions) {
    if (
      !strategyIdMatches({
        contributed: ext.metadata.strategyId,
        active: strategyId,
      })
    ) {
      continue;
    }
    Object.assign(map, ext.metadata.buildResolvers(ctx));
  }
  return map;
}

/**
 * Wait for a resolver to appear under `name`, polling the live map. Local
 * frontend plugins load as separate lazy chunks and register REACTIVELY, so a
 * dropdown field can mount (and call its resolver) a beat before the owning
 * plugin's chunk has registered its factory. Rather than let `DynamicForm` show
 * a permanent "resolver not found" for that cold-start window, the proxy resolver
 * (below) waits briefly for the real one. Resolves immediately once present;
 * throws a clear error if it never arrives within `timeoutMs`.
 *
 * `now`/`sleep` are injectable so the polling loop is unit-testable without real
 * timers.
 */
export async function waitForResolver({
  name,
  getResolvers,
  timeoutMs = 8000,
  pollMs = 60,
  now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}: {
  name: string;
  getResolvers: () => Record<string, OptionsResolver>;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<OptionsResolver> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const resolver = getResolvers()[name];
    if (resolver) return resolver;
    if (now() >= deadline) {
      throw new Error(`No options resolver registered for "${name}"`);
    }
    await sleep(pollMs);
  }
}

/**
 * A STABLE `optionsResolvers` object for `DynamicForm` that resolves each name
 * against the LATEST built map at call time (not at build time).
 *
 * Two problems this solves at once:
 *  - `DynamicForm` reads `optionsResolvers[name]` synchronously on field mount
 *    and treats a missing entry as a hard error - so the object must always hand
 *    back a function, even before the owning plugin's chunk has registered.
 *  - The strategy config (e.g. the chosen `streamId`) changes as the operator
 *    edits, and a collector dropdown reopened later must resolve against the
 *    CURRENT selection. Reading `getResolvers()` at call time (which closes over
 *    the freshly built map) gives that without re-creating this object - so the
 *    reference stays stable and never churns the form.
 */
export function createResolverProxy({
  getResolvers,
  waitOptions,
}: {
  getResolvers: () => Record<string, OptionsResolver>;
  waitOptions?: Pick<
    Parameters<typeof waitForResolver>[0],
    "timeoutMs" | "pollMs" | "now" | "sleep"
  >;
}): Record<string, OptionsResolver> {
  return new Proxy<Record<string, OptionsResolver>>(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop !== "string") return;
        const name = prop;
        const resolver: OptionsResolver = async (formValues) => {
          const ready =
            getResolvers()[name] ??
            (await waitForResolver({ name, getResolvers, ...waitOptions }));
          return ready(formValues);
        };
        return resolver;
      },
    },
  );
}
