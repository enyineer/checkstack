/**
 * Authorization for EXPOSING catalog systems through a trace stream's link set.
 *
 * The `setSystemLinks` contract is `manage`-gated on the STREAM
 * (`idParam: "streamId"`), which proves the caller may manage THEIR stream - it
 * does NOT prove they may see the systems they are linking. A stream manager
 * must not be able to expose (surface on the system page / dashboard) a system
 * they cannot even read.
 *
 * This gate is ADDED-ONLY: only NEWLY added systems (the diff against the
 * currently persisted set) are readability-checked. Retained and removed ids
 * need no readability - a manager who cannot read a system another user linked
 * must still be able to save unrelated changes (or unlink it) without being
 * dead-locked by that link (see telemetry-common's system-links.ts contract).
 *
 * The check runs as a USER-scoped caller with ONE `getSystems` membership pass
 * (not per-id probes): `getSystems` is `listKey`-filtered to exactly the systems
 * the caller may read, so an added id absent from it is one the caller cannot
 * see. The caller-scoped client re-enters the router forwarding the caller's own
 * auth (canonical `createUserScopedRpcClient` from backend-api), injected into
 * the router so tests can substitute a deterministic authorizer.
 */

import { ORPCError } from "@orpc/server";
import {
  createUserScopedRpcClient,
  forwardableAuthHeadersFrom,
} from "@checkstack/backend-api";
import { CatalogApi } from "@checkstack/catalog-common";

/**
 * A per-request gate the router invokes before persisting a link set, over the
 * NEWLY ADDED systems only. Bound to the internal URL once; called with the
 * caller's request headers so the re-entrant catalog reads run as the caller.
 */
export type SystemLinkAuthorizer = (args: {
  addedSystemIds: string[];
  requestHeaders: Headers | undefined;
}) => Promise<void>;

/**
 * Pure membership check: every added system must be present in the caller's
 * readable set, else FORBIDDEN. Extracted so the "cannot expose what you cannot
 * see" verdict is unit-testable without an HTTP round-trip.
 */
export function assertAddedSystemsReadable({
  addedSystemIds,
  readableSystemIds,
}: {
  addedSystemIds: string[];
  readableSystemIds: Iterable<string>;
}): void {
  const readable = new Set(readableSystemIds);
  const unreadable = addedSystemIds.filter((id) => !readable.has(id));
  if (unreadable.length > 0) {
    throw new ORPCError("FORBIDDEN", {
      message: "You can only link systems you can read.",
    });
  }
}

/**
 * Production {@link SystemLinkAuthorizer}: skips the catalog entirely when
 * nothing was added; otherwise runs ONE caller-scoped `getSystems` membership
 * pass and rejects if any added system is not in the caller's readable set.
 */
export function createSystemLinkAuthorizer({
  internalUrl,
}: {
  internalUrl: string;
}): SystemLinkAuthorizer {
  return async ({ addedSystemIds, requestHeaders }) => {
    if (addedSystemIds.length === 0) return;
    const client = createUserScopedRpcClient({
      internalUrl,
      forwardHeaders: forwardableAuthHeadersFrom(requestHeaders),
    });
    const { systems } = await client.forPlugin(CatalogApi).getSystems();
    assertAddedSystemsReadable({
      addedSystemIds,
      readableSystemIds: systems.map((s) => s.id),
    });
  };
}
