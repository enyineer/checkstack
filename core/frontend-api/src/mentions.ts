import type { MentionRef } from "@checkstack/common";

/**
 * Cross-entity mentions, contributed by the plugin that OWNS the record type.
 *
 * ## Why a registry and not direct imports
 *
 * An incident update that references a maintenance window is the obvious case,
 * but the same affordance should work for systems, SLOs, and whatever comes
 * next. Wiring each pair directly would mean every domain plugin importing
 * every other one - the exact dependency inversion the platform rules forbid.
 * So the platform (this module) defines the contract, and each owning plugin
 * registers a provider for its own type. No plugin knows about any other.
 */

/** One suggestion offered while the author is typing a mention. */
export interface MentionSuggestion {
  /** The referenced record's id. */
  id: string;
  /** What the author sees and what is inserted as the link label. */
  label: string;
  /** Optional second line - a status, a date - to disambiguate similar titles. */
  description?: string;
}

export interface MentionProvider {
  /**
   * The record type this provider owns, e.g. `incident`. Becomes the `type`
   * segment of every href it produces, so it must be stable: changing it
   * orphans every mention already written.
   */
  type: string;
  /** Plural noun shown as the suggestion group heading, e.g. "Incidents". */
  displayName: string;
  /**
   * Find records matching what the author has typed so far.
   *
   * MUST return only records the caller may READ. The suggestion list is an
   * information channel of its own: offering a title the viewer is not allowed
   * to see leaks it whether or not they pick it.
   */
  search: (props: { query: string }) => Promise<MentionSuggestion[]>;
  /**
   * The in-app route for a referenced record, or `undefined` when this viewer
   * should not get a link (see `MentionResolver` in `@checkstack/ui`).
   */
  toRoute: (props: { id: string }) => string | undefined;
}

/**
 * Process-global provider registry.
 *
 * Global rather than React context because the same registry has to be
 * reachable from a render path (`resolveMention`, called deep inside a markdown
 * renderer that cannot take a hook) and from an editor's async search. Keyed on
 * `globalThis` for the same reason `createRegisteredContext` is: `@checkstack/
 * frontend-api` is bundled per consumer, so a module-level `Map` would give the
 * host and each plugin their own empty copy.
 */
const REGISTRY_KEY = "__checkstack_mention_providers__";

function registry(): Map<string, MentionProvider> {
  const host = globalThis as Record<string, unknown>;
  const existing = host[REGISTRY_KEY];
  if (existing instanceof Map) return existing as Map<string, MentionProvider>;

  const created = new Map<string, MentionProvider>();
  host[REGISTRY_KEY] = created;
  return created;
}

/**
 * Register a provider for one record type.
 *
 * Last registration wins, so a plugin reloaded at runtime replaces its own
 * provider rather than accumulating duplicates.
 */
export function registerMentionProvider(provider: MentionProvider): void {
  registry().set(provider.type, provider);
}

/** Every registered provider, ordered by display name for a stable UI. */
export function listMentionProviders(): MentionProvider[] {
  return [...registry().values()].toSorted((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export function getMentionProvider({
  type,
}: {
  type: string;
}): MentionProvider | undefined {
  return registry().get(type);
}

/**
 * Resolve a mention to an in-app route.
 *
 * An unregistered type resolves to `undefined`, so a reference to a record
 * whose plugin is not installed renders as plain text instead of a dead link.
 */
export function resolveMentionRoute(ref: MentionRef): string | undefined {
  return getMentionProvider({ type: ref.type })?.toRoute({ id: ref.id });
}

/**
 * Search every provider concurrently and flatten the results.
 *
 * A provider that throws contributes nothing rather than failing the whole
 * lookup - one plugin's outage must not make the mention picker unusable.
 */
export async function searchMentions({
  query,
  limitPerType = 5,
}: {
  query: string;
  limitPerType?: number;
}): Promise<Array<MentionSuggestion & { type: string; displayName: string }>> {
  const providers = listMentionProviders();

  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      try {
        const results = await provider.search({ query });
        return results.slice(0, limitPerType).map((suggestion) => ({
          ...suggestion,
          type: provider.type,
          displayName: provider.displayName,
        }));
      } catch {
        return [];
      }
    }),
  );

  return perProvider.flat();
}

/**
 * Install the search half of a provider from inside React.
 *
 * The registry itself is process-global (it has to be reachable from a render
 * path that cannot take a hook), but SEARCHING needs an RPC client, and the
 * client is only obtainable from React context. So a plugin registers its
 * routing half at module scope - which is enough for every mention to RENDER -
 * and mounts a tiny headless component that installs the search half once the
 * app is running.
 *
 * Splitting it this way means a plugin whose search is unavailable still
 * resolves existing mentions correctly; only the authoring picker is affected.
 */
export function setMentionSearch({
  type,
  search,
}: {
  type: string;
  search: MentionProvider["search"];
}): void {
  const provider = registry().get(type);
  if (!provider) return;
  registry().set(type, { ...provider, search });
}

/**
 * Register the routing half of a provider.
 *
 * Safe to call at module scope. `search` defaults to returning nothing, so a
 * provider whose search is never installed simply offers no suggestions rather
 * than throwing inside the picker.
 */
export function registerMentionRoutes({
  type,
  displayName,
  toRoute,
}: Pick<MentionProvider, "type" | "displayName" | "toRoute">): void {
  const existing = registry().get(type);
  registry().set(type, {
    type,
    displayName,
    toRoute,
    search: existing?.search ?? (async () => []),
  });
}
