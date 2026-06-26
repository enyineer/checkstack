import { z } from "zod";
import { createSignal } from "@checkstack/signal-common";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast whenever a catalog entity (system, group, environment, or a
 * system's memberships) is created, updated, or deleted - by ANY path: the UI,
 * the AI assistant (which mutates on the backend, so no frontend mutation
 * runs), GitOps reconcile, or another pod/user. The frontend signal
 * auto-invalidator refreshes every client's `[[catalog]]` react-query cache
 * from it, so an open catalog/system page never serves a stale list after an
 * out-of-band change.
 *
 * Catalog reads are coarse (one `getSystems` list backs the catalog page AND
 * the system detail page, which resolves a system by finding it in that list),
 * so a single coarse "changed" signal is the right granularity: the
 * auto-invalidator keys off `pluginId`, not the payload. The payload is
 * descriptive only (debugging / future targeted consumers).
 */
export const CATALOG_CHANGED = createSignal({
  pluginMetadata,
  event: "changed",
  payloadSchema: z.object({
    /** Which kind of catalog entity changed. */
    entity: z.enum(["system", "group", "environment", "membership"]),
    /** What happened to it. */
    action: z.enum(["created", "updated", "deleted"]),
    /** The affected entity id, when applicable. */
    id: z.string().optional(),
  }),
});
