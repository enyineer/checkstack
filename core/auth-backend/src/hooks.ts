import { createHook } from "@checkmate/backend-api";

/**
 * Auth hooks for cross-plugin communication
 */
export const authHooks = {
  /**
   * Emitted when a user is deleted.
   * Plugins can subscribe (work-queue mode) to clean up related data.
   */
  userDeleted: createHook<{
    userId: string;
  }>("auth.user.deleted"),
} as const;
