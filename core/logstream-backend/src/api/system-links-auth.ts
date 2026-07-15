/**
 * Authorization for LINKING a log stream to catalog systems.
 *
 * SECURITY: the `systemIds` on `setSystemLinks` are caller-supplied. The
 * stream-scoped `manage` gate (idParam: "streamId") only proves the caller may
 * manage THEIR stream - it does NOT prove they may READ the systems they attach.
 * A stream manager must not be able to expose (link, and thereby surface on the
 * system page + dashboard) a system they cannot even see. This authorizer closes
 * that: it re-enters catalog AS the caller (a user-scoped client forwarding their
 * auth) so catalog's own `system.read` RLAC decides what the caller can see.
 *
 * ADDED-ONLY: the router passes ONLY the newly-added system ids (requested minus
 * already-persisted). Re-saving a set that retains an already-linked system the
 * caller can no longer read must not block an unrelated edit, and UNLINKING
 * needs no readability at all - only genuinely NEW exposures are gated.
 *
 * MEMBERSHIP PASS: one `getSystems` call returns exactly the systems the caller
 * may read (RLAC `listKey` on `system.read`); every added id must be in that set.
 * A single set read replaces N per-id `getSystem` round-trips.
 *
 * Injected into the router (like metricstream/tracestream) so tests can
 * substitute a deterministic authorizer without an HTTP round-trip.
 */

import { ORPCError } from "@orpc/server";
import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "@checkstack/backend-api";
import { CatalogApi } from "@checkstack/catalog-common";

/**
 * A per-request gate the router invokes before persisting newly-added links.
 * Bound to the internal URL once; called with the caller's request headers so
 * the re-entrant catalog read runs as the caller. `systemIds` is the ADDED set.
 */
export type SystemLinkAuthorizer = (args: {
  systemIds: string[];
  requestHeaders: Headers | undefined;
}) => Promise<void>;

/**
 * Pure membership pass: the added system ids the caller CANNOT read (not in the
 * readable set), preserving input order. Extracted so the set logic is unit
 * tested without an HTTP round-trip.
 */
export function findUnreadableSystemIds({
  addedSystemIds,
  readableSystemIds,
}: {
  addedSystemIds: readonly string[];
  readableSystemIds: Iterable<string>;
}): string[] {
  const readable = new Set(readableSystemIds);
  return addedSystemIds.filter((id) => !readable.has(id));
}

/**
 * Production {@link SystemLinkAuthorizer}: for each request, builds a
 * caller-scoped catalog client and asserts every ADDED system is in the caller's
 * readable set (one `getSystems` membership pass), throwing FORBIDDEN naming the
 * inaccessible ids. A no-op when nothing was added (an unlink / no-change save).
 */
export function createSystemLinkAuthorizer({
  internalUrl,
}: {
  internalUrl: string;
}): SystemLinkAuthorizer {
  return async ({ systemIds, requestHeaders }) => {
    if (systemIds.length === 0) return;
    const client = createUserScopedRpcClient({
      internalUrl,
      forwardHeaders: forwardableAuthHeadersFrom(requestHeaders),
    });
    const { systems } = await client.forPlugin(CatalogApi).getSystems();
    const unreadable = findUnreadableSystemIds({
      addedSystemIds: systemIds,
      readableSystemIds: systems.map((s) => s.id),
    });
    if (unreadable.length > 0) {
      throw new ORPCError("FORBIDDEN", {
        message: `You can only link systems you can access. These are not accessible: ${unreadable.join(", ")}.`,
      });
    }
  };
}
