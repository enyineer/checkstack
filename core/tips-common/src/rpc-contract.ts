import {
  createClientDefinition,
  proc,
  type PluginMetadata,
} from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";

/**
 * Fully-qualified tip identifier — the wire format used in RPC payloads and
 * stored in the database.
 *
 * Shape: `<pluginId>.<localTipId>`. The `.` is the namespace separator and
 * MUST appear at least once. Plugins cannot construct a fully-qualified ID
 * directly — they must go through `qualifyTipId` (or the frontend hooks /
 * components, which call it for them) which prefixes the caller's own
 * `pluginId` and rejects local IDs that contain a `.` themselves. This is
 * what prevents one plugin from forging a tip in another plugin's
 * namespace.
 */
export const TipIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+$/, {
    message:
      "Tip IDs must be `<pluginId>.<localTipId>` and contain only letters, numbers, dots, dashes and underscores",
  });

export type TipId = z.infer<typeof TipIdSchema>;

/**
 * Local (post-namespace) tip identifier.
 *
 * This is what a plugin author writes in their code — e.g. `"systems.create"`
 * — and explicitly forbids the namespace separator at the start so a plugin
 * cannot author a tip that masquerades as belonging to another plugin.
 *
 * Allowed characters: letters, numbers, dots, dashes, underscores. The dot
 * is allowed *inside* the local part for further sub-grouping (e.g.
 * `"systems.create.first-time"`), but a leading or trailing dot is rejected
 * so the concatenation with `<pluginId>.` always produces a well-formed
 * fully-qualified ID with exactly one separator at the boundary.
 */
export const LocalTipIdSchema = z
  .string()
  .min(1)
  .max(150)
  .regex(/^[a-zA-Z0-9_-](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?$/, {
    message:
      "Local tip IDs may contain letters, numbers, dots, dashes and underscores, and must not start or end with a dot",
  });

export type LocalTipId = z.infer<typeof LocalTipIdSchema>;

/**
 * Qualify a local tip ID with the calling plugin's namespace.
 *
 * This is the ONLY supported way to produce a fully-qualified tip ID from
 * plugin code. Both the local ID and the resulting fully-qualified ID are
 * validated at runtime, so:
 *
 * - A plugin cannot pass a local ID containing a leading dot (e.g.
 *   `".other-plugin.tip"`) to escape into another namespace.
 * - The frontend hooks and components (`useTipState`, `<Tip>`,
 *   `<TipBanner>`) accept only `(plugin, localId)` pairs and route through
 *   this helper, so they cannot bypass namespacing either.
 */
export const qualifyTipId = (
  plugin: Pick<PluginMetadata, "pluginId">,
  localId: string,
): TipId => {
  const parsedLocal = LocalTipIdSchema.parse(localId);
  const fullyQualified = `${plugin.pluginId}.${parsedLocal}`;
  return TipIdSchema.parse(fullyQualified);
};

/** Server-returned dismissed tip record. */
export const DismissedTipSchema = z.object({
  tipId: TipIdSchema,
  dismissedAt: z.date(),
});
export type DismissedTip = z.infer<typeof DismissedTipSchema>;

/**
 * Tips RPC Contract.
 *
 * All endpoints are scoped to the requesting user — there is no cross-user
 * read or admin surface.
 */
export const tipsContract = {
  /** List tip IDs the current user has dismissed. */
  listDismissed: proc({
    operationType: "query",
    userType: "user",
    access: [],
  }).output(
    z.object({
      dismissed: z.array(DismissedTipSchema),
    }),
  ),

  /** Mark a tip as dismissed for the current user. Idempotent. */
  dismiss: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        tipId: TipIdSchema,
      }),
    )
    .output(z.void()),

  /**
   * Reset (un-dismiss) tips for the current user.
   *
   * If `tipIds` is omitted, ALL of the user's dismissed tips are cleared
   * (used by the "replay onboarding" affordance).
   */
  reset: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        tipIds: z.array(TipIdSchema).optional(),
      }),
    )
    .output(z.void()),
};

export type TipsContract = typeof tipsContract;

/**
 * Client definition for type-safe `rpcApi.forPlugin(TipsApi)` usage.
 */
export const TipsApi = createClientDefinition(tipsContract, pluginMetadata);
