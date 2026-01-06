import { z } from "zod";

/**
 * Standard pagination input schema for RPC procedures.
 * Use with paginatedOutput() for consistent pagination patterns.
 *
 * @example
 * ```typescript
 * // In your contract:
 * import { PaginationInputSchema, paginatedOutput } from "@checkmate-monitor/common";
 *
 * const contract = {
 *   getItems: _base
 *     .input(PaginationInputSchema.extend({ search: z.string().optional() }))
 *     .output(paginatedOutput(ItemSchema)),
 * };
 * ```
 */
export const PaginationInputSchema = z.object({
  /** Number of items per page (1-100) */
  limit: z.number().min(1).max(100).default(10),
  /** Number of items to skip */
  offset: z.number().min(0).default(0),
});

export type PaginationInput = z.infer<typeof PaginationInputSchema>;

/**
 * Creates a paginated output schema wrapper.
 * Returns { items: T[], total: number } structure that works with usePagination hook.
 *
 * @example
 * ```typescript
 * // Contract definition:
 * getUsers: _base
 *   .input(PaginationInputSchema)
 *   .output(paginatedOutput(UserSchema)),
 *
 * // Returns: { items: User[], total: number }
 * ```
 */
export function paginatedOutput<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
  });
}

/**
 * Type helper for paginated responses
 */
export type PaginatedResponse<T> = {
  items: T[];
  total: number;
};
