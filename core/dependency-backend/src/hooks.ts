import { createHook } from "@checkstack/backend-api";

/**
 * Dependency hooks for cross-plugin communication.
 * Other plugins can subscribe to these hooks to react to dependency changes.
 */
export const dependencyHooks = {
  /**
   * Emitted when a dependency is created.
   */
  dependencyCreated: createHook<{
    dependencyId: string;
    sourceSystemId: string;
    targetSystemId: string;
    impactType: string;
  }>("dependency.created"),

  /**
   * Emitted when a dependency is updated.
   */
  dependencyUpdated: createHook<{
    dependencyId: string;
    sourceSystemId: string;
    targetSystemId: string;
    impactType: string;
  }>("dependency.updated"),

  /**
   * Emitted when a dependency is deleted.
   */
  dependencyDeleted: createHook<{
    dependencyId: string;
    sourceSystemId: string;
    targetSystemId: string;
  }>("dependency.deleted"),
} as const;
