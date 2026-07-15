/**
 * Authorization for EXPOSING catalog systems through a stream's link set.
 *
 * `setSystemLinks` is `manage`-gated on the STREAM (`idParam: "streamId"`),
 * which proves the caller may manage THEIR stream - NOT that they may SEE the
 * systems they are linking. A stream manager must not expose (surface on the
 * system page / dashboard) a system they cannot read. This gate closes that,
 * but ONLY for NEWLY ADDED systems: the service diffs the requested set against
 * the persisted one and passes just the additions here. Retained/removed ids
 * need no readability - a manager who cannot read a system another user linked
 * must still be able to save unrelated changes (or unlink it) without being
 * dead-locked by that link (see the contract in telemetry-common/system-links.ts).
 *
 * ONE user-scoped `getSystems` MEMBERSHIP pass, never per-id probes: `getSystems`
 * is RLAC'd `listKey: "systems"` on `system.read`, so it returns EXACTLY the
 * caller's readable systems; every added id must be a member. Same injected-
 * authorizer convention as the satellite-binding gate; the user-scoped client
 * plumbing is the canonical `@checkstack/backend-api` helper.
 */

import { ORPCError } from "@orpc/server";
import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "@checkstack/backend-api";
import { CatalogApi } from "@checkstack/catalog-common";

/**
 * A per-request gate the service invokes before persisting, over the NEWLY
 * ADDED system ids only. Bound to the internal URL once; called with the
 * caller's request headers so the re-entrant catalog read runs as the caller.
 */
export type SystemLinksReadableAuthorizer = (args: {
  /** The NEWLY ADDED system ids (already diffed against the persisted set). */
  addedSystemIds: string[];
  requestHeaders: Headers | undefined;
}) => Promise<void>;

/**
 * Production {@link SystemLinksReadableAuthorizer}: skips the catalog round-trip
 * when nothing new is being linked; otherwise runs ONE user-scoped `getSystems`
 * membership pass and throws FORBIDDEN if any added id is not in the caller's
 * readable set, so `setSystemLinks` never exposes a system the caller cannot see.
 */
export function createSystemLinksReadableAuthorizer({
  internalUrl,
}: {
  internalUrl: string;
}): SystemLinksReadableAuthorizer {
  return async ({ addedSystemIds, requestHeaders }) => {
    // Skip the catalog call entirely when there are no additions.
    if (addedSystemIds.length === 0) return;
    const client = createUserScopedRpcClient({
      internalUrl,
      forwardHeaders: forwardableAuthHeadersFrom(requestHeaders),
    });
    // ONE membership pass: getSystems returns exactly the caller's readable set.
    const { systems } = await client.forPlugin(CatalogApi).getSystems();
    const readable = new Set(systems.map((s) => s.id));
    if (addedSystemIds.some((id) => !readable.has(id))) {
      throw new ORPCError("FORBIDDEN", {
        message: "You can only link systems you can access.",
      });
    }
  };
}
