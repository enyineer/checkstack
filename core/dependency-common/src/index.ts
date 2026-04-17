export { dependencyAccess, dependencyAccessRules } from "./access";
export {
  dependencyContract,
  DependencyApi,
  type DependencyContract,
} from "./rpc-contract";
export {
  ImpactTypeSchema,
  DerivedStateSchema,
  HealthCheckRuleSchema,
  DependencySchema,
  AffectedUpstreamSchema,
  DependencyWarningSchema,
  CreateHealthCheckRuleInputSchema,
  CreateDependencyInputSchema,
  UpdateDependencyInputSchema,
  NodePositionSchema,
  type ImpactType,
  type DerivedState,
  type HealthCheckRule,
  type Dependency,
  type AffectedUpstream,
  type DependencyWarning,
  type CreateDependencyInput,
  type UpdateDependencyInput,
  type NodePosition,
} from "./schemas";
export * from "./plugin-metadata";
export { dependencyRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";

/**
 * Broadcast when dependency definitions change (created, updated, deleted).
 * Frontend components can refetch the dependency graph.
 */
export const DEPENDENCY_CHANGED = createSignal(
  "dependency.changed",
  z.object({
    dependencyId: z.string(),
    sourceSystemId: z.string(),
    targetSystemId: z.string(),
    action: z.enum(["created", "updated", "deleted"]),
  }),
);

/**
 * Broadcast when computed dependency warnings change for one or more systems.
 * Badge components listen to this to refresh without polling.
 */
export const DEPENDENCY_WARNINGS_CHANGED = createSignal(
  "dependency.warnings.changed",
  z.object({
    affectedSystemIds: z.array(z.string()),
  }),
);
