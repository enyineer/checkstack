import { z } from "zod";

/**
 * Canonical pagination input schema for RPC procedures.
 *
 * This is the single source of truth for paginated list inputs across
 * the platform. Domain-specific extras (e.g. `unreadOnly` on
 * notifications) must compose with `.extend({...})` — do NOT redefine
 * the base fields.
 *
 * @example
 * ```typescript
 * import { PaginationInput, PaginatedResult } from "@checkstack/common";
 *
 * const ListNotificationsInput = PaginationInput.extend({
 *   unreadOnly: z.boolean().default(false),
 * });
 *
 * const ListNotificationsOutput = PaginatedResult(NotificationSchema);
 * ```
 */
export const PaginationInput = z.object({
  /** Number of items per page (1-100). */
  limit: z.number().int().min(1).max(100).default(20),
  /** Number of items to skip from the start of the result set. */
  offset: z.number().int().min(0).default(0),
});

export type PaginationInput = z.infer<typeof PaginationInput>;

/**
 * Canonical paginated response factory.
 *
 * Wraps an item schema in the standard `{ items, total, limit, offset }`
 * shape. The echoed `limit` / `offset` mirror what the server actually
 * applied so clients can render correct pagination controls even when
 * defaults were used.
 *
 * @example
 * ```typescript
 * // In a contract:
 * getNotifications: _base
 *   .input(PaginationInput)
 *   .output(PaginatedResult(NotificationSchema)),
 *
 * // Returns: { items: Notification[], total: number, limit: number, offset: number }
 * ```
 */
export const PaginatedResult = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int().min(0),
    limit: z.number().int(),
    offset: z.number().int(),
  });
