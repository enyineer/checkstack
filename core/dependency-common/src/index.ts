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
export * from "./notifications";
export { dependencyRoutes } from "./routes";
export {
  deriveDependencySignals,
  DEPENDENCY_SIGNAL_SOURCE_ID,
} from "./signals";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when dependency definitions change (created, updated, deleted).
 * Frontend components can refetch the dependency graph.
 */
export const DEPENDENCY_CHANGED = createSignal({
  pluginMetadata,
  event: "changed",
  payloadSchema: z.object({
    dependencyId: z.string(),
    sourceSystemId: z.string(),
    targetSystemId: z.string(),
    action: z.enum(["created", "updated", "deleted"]),
  }),
});

/**
 * Broadcast when computed dependency warnings change for one or more systems.
 * Badge components listen to this to refresh without polling.
 */
export const DEPENDENCY_WARNINGS_CHANGED = createSignal({
  pluginMetadata,
  event: "warnings.changed",
  payloadSchema: z.object({
    affectedSystemIds: z.array(z.string()),
  }),
});
